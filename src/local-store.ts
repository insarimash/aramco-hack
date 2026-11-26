import { randomBytes, scrypt as callbackScrypt, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, open, readFile, rename, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const scrypt = promisify(callbackScrypt);
const directory = process.env.CBAM_DATA_DIR || path.join(process.cwd(), "local-data");
const file = path.join(directory, "store.json");
const cookieName = "cbam_session";
const lifetime = 7 * 24 * 60 * 60 * 1000;
type User = { id: string; email: string; salt: string; passwordHash: string };
type Session = { userId: string; tokenHash: string; expires: number };
export type SavedReview = { run: string; fileName: string; createdAt: string; completedAt?: string; result?: unknown; failure?: string; hasSource?: boolean };
type Store = { users: User[]; sessions: Session[]; reviews: (SavedReview & { userId: string })[] };
let queue: Promise<unknown> = Promise.resolve();

function locked<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => {});
  return next;
}
async function read(): Promise<Store> {
  try { return JSON.parse(await readFile(file, "utf8")) as Store; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { users: [], sessions: [], reviews: [] };
    throw error;
  }
}
async function write(store: Store) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = file + "." + randomBytes(8).toString("hex");
  await writeFile(temporary, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(temporary, file);
}
function digest(token: string) { return createHash("sha256").update(token).digest("hex"); }
function tokenFrom(request: Request) {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(cookieName + "="))?.slice(cookieName.length + 1) ?? "";
}
function userFor(store: Store, request: Request) {
  const token = tokenFrom(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return undefined;
  const session = store.sessions.find((item) => item.tokenHash === digest(token) && item.expires > Date.now());
  return store.users.find((item) => item.id === session?.userId);
}
export function sessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${lifetime / 1000}${secure}`;
}
export function clearCookie(request: Request) { return sessionCookie("", request).replace(`Max-Age=${lifetime / 1000}`, "Max-Age=0"); }
export async function currentUser(request: Request) {
  return locked(async () => { const user = userFor(await read(), request); return user && { id: user.id, email: user.email }; });
}
export async function register(email: string, password: string) {
  return locked(async () => {
    const store = await read();
    if (store.users.some((user) => user.email === email)) return undefined;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString("hex");
    const user = { id: randomBytes(16).toString("hex"), email, salt, passwordHash };
    store.users.push(user);
    const token = randomBytes(32).toString("hex");
    store.sessions.push({ userId: user.id, tokenHash: digest(token), expires: Date.now() + lifetime });
    await write(store);
    return { token, email };
  });
}
export async function login(email: string, password: string) {
  return locked(async () => {
    const store = await read();
    const user = store.users.find((item) => item.email === email);
    if (!user) return undefined;
    const hash = await scrypt(password, user.salt, 64) as Buffer;
    if (!timingSafeEqual(hash, Buffer.from(user.passwordHash, "hex"))) return undefined;
    const token = randomBytes(32).toString("hex");
    store.sessions.push({ userId: user.id, tokenHash: digest(token), expires: Date.now() + lifetime });
    await write(store);
    return { token, email };
  });
}
export async function logout(request: Request) {
  await locked(async () => { const store = await read(); store.sessions = store.sessions.filter((item) => item.tokenHash !== digest(tokenFrom(request))); await write(store); });
}
function sourcePath(userId: string, run: string) {
  return path.join(directory, "sources", digest(userId + ":" + run));
}
export async function addReview(userId: string, run: string, document: File) {
  const target = sourcePath(userId, run);
  const hasSource = await (async () => {
    try {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await pipeline(Readable.fromWeb(document.stream() as NodeReadableStream<Uint8Array>), createWriteStream(target, { mode: 0o600 }));
      return true;
    } catch {
      await rm(target, { force: true }).catch(() => {});
      return false;
    }
  })();
  await locked(async () => { const store = await read(); store.reviews.push({ userId, run, fileName: document.name, hasSource, createdAt: new Date().toISOString() }); await write(store); });
}
export async function getReview(userId: string, run: string) {
  return locked(async () => (await read()).reviews.find((item) => item.userId === userId && item.run === run));
}
export async function reviewSource(userId: string, run: string) {
  const review = await getReview(userId, run);
  if (!review?.hasSource) return;
  const source = await open(sourcePath(userId, run), "r").catch(() => undefined);
  if (source) return { fileName: review.fileName, stream: Readable.toWeb(source.createReadStream()) as ReadableStream<Uint8Array> };
}
export async function completeReview(userId: string, run: string, result: unknown, failure?: string) {
  await locked(async () => { const store = await read(); const item = store.reviews.find((review) => review.userId === userId && review.run === run); if (item && !item.completedAt) { item.result = result; item.failure = failure; item.completedAt = new Date().toISOString(); await write(store); } });
}
export async function history(userId: string) {
  return locked(async () => (await read()).reviews.filter((item) => item.userId === userId).map(({ run, fileName, createdAt, completedAt, result, failure, hasSource }) => ({ run, fileName, createdAt, completedAt, result, failure, hasSource })).reverse());
}
