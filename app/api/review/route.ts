import { readResult } from "../../../src/upstage-result";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { captureUpstageResponse } from "../../../src/upstage-capture";
import { canRecheckResult, maxFileBytes, validateFile, type ReviewResponse } from "../../../src/review";
import { addReview, completeReview, currentUser, getReview } from "../../../src/local-store";

export const runtime = "nodejs";
const base = "https://api.upstage.ai/v2";
const bodyLimit = maxFileBytes + 65_536;
let uploading = false;

function reply(data: ReviewResponse, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function error(message: string, status: number, options: { unknown?: boolean; retry?: boolean; delay?: number } = {}) {
  return reply({ state: "error", message, ...options }, status);
}

function upstreamError(response: Response, phase: "upload" | "create" | "poll") {
  const status = response.status;
  if (status === 401 || status === 403) return error("Upstage rejected authentication. Check UPSTAGE_API_KEY and agent access.", 502);
  if (status === 404) return error("Upstage could not find the agent or job. Check the configured agent and job in Studio.", 502);
  if (status === 413) return error("Upstage rejected the document size. Check the file and page limits.", 413);
  if (status === 429) {
    const header = response.headers.get("Retry-After");
    const seconds = header && /^\d+$/.test(header) ? Number(header) : 0;
    const delay = Math.max(3, seconds, header ? Math.ceil((Date.parse(header) - Date.now()) / 1000) || 0 : 0);
    return error("Upstage is rate limiting requests. Wait before trying again.", 429, { retry: true, delay });
  }
  if (phase === "create" && status >= 500) return uncertain();
  return error("Upstage could not handle the request. Try again in a few seconds.", 502, { retry: status >= 500 });
}

function uncertain() {
  return error("Upstage may have started a job. Check Studio before starting another review.", 502, { unknown: true });
}

function signature(id: string, key: string) {
  return createHmac("sha256", key).update("cbam-review:" + id).digest("base64url");
}

function readRun(token: string, key: string) {
  const match = /^([\w-]{1,256})\.([\w-]{43})$/.exec(token);
  if (match && timingSafeEqual(Buffer.from(match[2]), Buffer.from(signature(match[1], key)))) return match[1];
}

function requestUpstage(path: string, key: string, init: RequestInit, timeout: number) {
  return fetch(base + path, {
    ...init,
    headers: { ...init.headers, Authorization: "Bearer " + key },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  });
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return error("Please sign in to run a review.", 401);
  const key = process.env.UPSTAGE_API_KEY?.trim();
  if (!key) return error("The server needs an Upstage API key. Ask the demo operator to configure it.", 503);
  if (request.headers.get("X-CBAM-Upload") !== "1") return error("Upload one file using the upload form.", 400);
  const contentType = request.headers.get("content-type") ?? "";
  if (!request.body || !/^multipart\/form-data;/i.test(contentType)) return error("Upload one file using the upload form.", 400);
  if (Number(request.headers.get("content-length")) > bodyLimit) return error("The file exceeds the 500 MB limit.", 413);
  if (uploading) return error("The server is receiving another document. Try again shortly.", 503, { delay: 3 });

  uploading = true;
  let creating = false;
  try {
    let bytes = 0;
    let tooLarge = false;
    const boundedBody = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > bodyLimit) {
          tooLarge = true;
          controller.error(new Error("Upload limit exceeded"));
        } else {
          controller.enqueue(chunk);
        }
      },
    }));
    const init = { method: "POST", headers: { "Content-Type": contentType }, body: boundedBody, duplex: "half" };
    const form = await new Request(request.url, init).formData().catch(() => null);
    if (tooLarge) return error("The file exceeds the 500 MB limit.", 413);
    const file = form?.get("file");
    if (!form || [...form].length !== 1 || !(file instanceof File)) return error("Choose exactly one file.", 400);
    const invalid = validateFile(file);
    if (invalid) return error(invalid, 400);

    const document = new FormData();
    document.set("file", file);
    document.set("purpose", "user_data");
    const submission = "submission-" + randomUUID();
    const upload = await requestUpstage("/files", key, { method: "POST", body: document }, 600_000);
    const uploadBody = await captureUpstageResponse(upload, submission, "upload");
    if (!upload.ok) return upstreamError(upload, "upload");
    const { id: fileId } = object(JSON.parse(uploadBody));
    if (typeof fileId !== "string" || !fileId) return error("Upstage returned no file reference. Try the upload again.", 502);

    creating = true;
    const creation = await requestUpstage("/responses", key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.UPSTAGE_AGENT_ID?.trim() || "agt_LCcDmm5fNHW8mu5gG3ZS8W",
        config_id: process.env.UPSTAGE_CONFIG_ID?.trim() || "10",
        include: ["last"],
        input: [{ role: "user", content: [{ type: "input_file", file_id: fileId }] }],
      }),
    }, 60_000);
    const creationBody = await captureUpstageResponse(creation, submission, "create");
    if (!creation.ok) return upstreamError(creation, "create");
    const { id } = object(JSON.parse(creationBody));
    if (typeof id !== "string" || !/^[\w-]{1,256}$/.test(id)) return uncertain();
    const run = id + "." + signature(id, key);
    await addReview(user.id, run, file);
    return reply({ state: "processing", run }, 202);
  } catch (cause) {
    if (creating) return uncertain();
    if (cause instanceof Error && cause.name === "TimeoutError") {
      return error("The file transfer to Upstage timed out. You can try uploading again.", 504);
    }
    return error("The file transfer to Upstage failed. Try uploading again shortly.", 502);
  } finally {
    uploading = false;
  }
}

const failureMessages: Record<string, string> = {
  context_length_exceeded: "The document has too much content to process. Reduce the page count or split it.",
  parse_error: "Upstage could not read this document. Check that it opens and try exporting a fresh copy.",
  invalid_request_error: "Upstage rejected the document or workflow settings. Check the file limits and the Studio configuration.",
  model_output_error: "A workflow step failed to produce usable output. Check the run in Studio.",
  rate_limit_exceeded: "This job ended because Upstage was rate limited.",
  timeout_error: "This job ended because an Upstage workflow step timed out.",
  server_error: "This job ended because of an Upstage server error.",
};
const stages = ["parse", "classify", "extract", "merge", "system"];

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return error("Please sign in to view this review.", 401);
  const token = new URL(request.url).searchParams.get("run") ?? "";
  const saved = await getReview(user.id, token);
  if (!saved) return error("This review does not belong to your account.", 403);
  if (saved.failure && !canRecheckResult(saved.failure)) return error(saved.failure, 422);
  if (saved.completedAt && !saved.failure) return reply({ state: "completed", result: saved.result });
  const key = process.env.UPSTAGE_API_KEY?.trim();
  if (!key) return error("The server needs an Upstage API key to check this job.", 503);
  const id = readRun(token, key);
  if (!id) return error("This job reference is invalid. Check the job in Studio.", 400);
  async function fail(message: string, delay?: number) {
    await completeReview(user!.id, token, undefined, message);
    return error(message, 422, { delay });
  }
  try {
    const response = await requestUpstage("/responses/" + id + "?include[]=last", key, {}, 20_000);
    const body = await captureUpstageResponse(response, id, "poll");
    if (!response.ok) return upstreamError(response, "poll");
    let job: Record<string, unknown>;
    try {
      job = object(JSON.parse(body));
    } catch {
      return error("Upstage returned a status response that could not be read as JSON. Recheck the existing job.", 502, { retry: true });
    }
    if (job.status === "completed") {
      const { result, issue } = readResult(job);
      if (result !== undefined) {
        await completeReview(user.id, token, result);
        return reply({ state: "completed", result });
      }
      return await fail("The job finished and " + issue + ". Check the final step in Upstage Studio for job " + id + ".");
    }
    if (job.status === "cancelled") return await fail("Upstage cancelled this job.");
    if (job.status === "failed") {
      const failure = object(job.error);
      const code = typeof failure.code === "string" ? failure.code : "";
      const step = typeof failure.step === "string" && stages.includes(failure.step) ? " Step: " + failure.step + "." : "";
      const retryable = ["rate_limit_exceeded", "timeout_error", "server_error"].includes(code);
      const message = Object.hasOwn(failureMessages, code) ? failureMessages[code] : "The workflow failed. Check this run in Studio.";
      return await fail(message + step, retryable ? 3 : undefined);
    }
    if (typeof job.status !== "string" || !job.status) return error("Upstage returned no job status.", 502, { retry: true });
    return reply({ state: "processing", run: token });
  } catch {
    return error("The status check timed out or could not reach Upstage. The existing job can still be checked.", 504, { retry: true });
  }
}
