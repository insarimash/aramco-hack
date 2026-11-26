import { clearCookie, currentUser, login, logout, register, sessionCookie } from "../../../src/local-store";
export const runtime = "nodejs";
const noStore = { "Cache-Control": "no-store" };
export async function GET(request: Request) { return Response.json({ user: await currentUser(request) ?? null }, { headers: noStore }); }
export async function POST(request: Request) {
  let body: { action?: string; email?: string; password?: string };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== "string" || password.length < 8 || password.length > 128) {
    return Response.json({ error: "Enter a valid email and a password of 8 to 128 characters." }, { status: 400 });
  }
  if (body.action !== "register" && body.action !== "login") return Response.json({ error: "Invalid action." }, { status: 400 });
  const account = body.action === "register" ? await register(email, password) : await login(email, password);
  if (!account) return Response.json({ error: body.action === "register" ? "An account with this email already exists." : "Incorrect email or password." }, { status: body.action === "register" ? 409 : 401 });
  return Response.json({ user: { email: account.email } }, { headers: { ...noStore, "Set-Cookie": sessionCookie(account.token, request) } });
}
export async function DELETE(request: Request) {
  await logout(request);
  return Response.json({ user: null }, { headers: { ...noStore, "Set-Cookie": clearCookie(request) } });
}
