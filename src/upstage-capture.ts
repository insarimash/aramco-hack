import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function captureUpstageResponse(
  response: Response,
  group: string,
  phase: "upload" | "create" | "poll",
) {
  const body = await response.text();
  const capturedAt = new Date().toISOString();
  const root = process.env.CBAM_DATA_DIR || path.join(process.cwd(), "local-data");
  const directory = path.join(root, "upstage-responses", group);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = capturedAt.replace(/:/g, "-") + "_" + phase + "_" + randomUUID() + ".json";
    await writeFile(path.join(directory, filename), JSON.stringify({
      capturedAt,
      phase,
      status: response.status,
      contentType: response.headers.get("content-type"),
      body,
    }), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    console.error("Could not save the Upstage " + phase + " response.", (error as NodeJS.ErrnoException).code);
  }
  return body;
}
