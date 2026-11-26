import { currentUser, history } from "../../../src/local-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  return Response.json({ reviews: await history(user.id) }, { headers: { "Cache-Control": "no-store" } });
}
