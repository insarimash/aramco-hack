import { currentUser, reviewSource } from "../../../../src/local-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return new Response("Please sign in.", { status: 401 });
  const source = await reviewSource(user.id, new URL(request.url).searchParams.get("run") ?? "");
  if (!source) return new Response("Source file unavailable.", { status: 404 });
  const pdf = /\.pdf$/i.test(source.fileName);
  const filename = encodeURIComponent(source.fileName.toWellFormed()).replace(/['()*]/g, (character) => "%" + character.charCodeAt(0).toString(16));
  return new Response(source.stream, { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": pdf ? "application/pdf" : "application/octet-stream",
    "Content-Disposition": `${pdf ? "inline" : "attachment"}; filename*=UTF-8''${filename}`,
    "X-Content-Type-Options": "nosniff",
  } });
}
