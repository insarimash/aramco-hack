import { createHmac, timingSafeEqual } from "node:crypto";
import { maxFileBytes, validateFile, type ReviewResponse } from "../../../src/review";

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
  void response.body?.cancel().catch(() => {});
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
    const upload = await requestUpstage("/files", key, { method: "POST", body: document }, 600_000);
    if (!upload.ok) return upstreamError(upload, "upload");
    const { id: fileId } = object(await upload.json());
    if (typeof fileId !== "string" || !fileId) return error("Upstage returned no file reference. Try the upload again.", 502);

    creating = true;
    const creation = await requestUpstage("/responses", key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.UPSTAGE_AGENT_ID?.trim() || "agt_5gEZbL3mwPnR9ofmsZDSfU",
        config_id: process.env.UPSTAGE_CONFIG_ID?.trim() || "1",
        include: ["last"],
        input: [{ role: "user", content: [{ type: "input_file", file_id: fileId }] }],
      }),
    }, 60_000);
    if (!creation.ok) return upstreamError(creation, "create");
    const { id } = object(await creation.json());
    if (typeof id !== "string" || !/^[\w-]{1,256}$/.test(id)) return uncertain();
    return reply({ state: "processing", run: id + "." + signature(id, key) }, 202);
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

function finalStepText(output: unknown) {
  if (!Array.isArray(output)) return undefined;
  const content = output.flatMap((item) => {
    const content = object(item).content;
    return Array.isArray(content) ? content : [];
  });
  return content.map(object).findLast((item) =>
    item.type === "output_text" && typeof item.text === "string" && item.text.trim()
  )?.text;
}

function readLeadingJson(text: string): number {
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === "\\") index++;
      else if (character === '"') quoted = false;
    } else if (character === '"') {
      quoted = true;
    } else if (character === "{" || character === "[") {
      depth++;
    } else if (character === "}" || character === "]") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}

function parseResult(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```(?=\s|$)/i.exec(trimmed);
  const json = fenced?.[1] ?? trimmed;
  const end = !fenced && json.startsWith("{") ? readLeadingJson(json) : json.length;
  const parsed: unknown = JSON.parse(json.slice(0, end));
  const remainder = fenced ? trimmed.slice(fenced[0].length) : json.slice(end);
  if (remainder && !/^\s*\r?\n/.test(remainder)) throw new SyntaxError("Expected a separate summary");
  const summary = remainder.trim();
  return summary && parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? { summary, ...parsed }
    : parsed;
}

function decodeResult(value: unknown): unknown {
  const parsed = typeof value === "string" ? parseResult(value) : value;
  return typeof parsed === "string" ? parseResult(parsed) : parsed;
}

function readResult(job: Record<string, unknown>) {
  const candidates = new Set([
    job.output_text,
    finalStepText(job.output),
    typeof job.content === "string" ? { content: job.content, metadata: job.metadata } : undefined,
  ]);
  let hasText = false;
  for (const candidate of candidates) {
    if (candidate == null || (typeof candidate === "string" && !candidate.trim())) continue;
    hasText = true;
    try {
      let result = decodeResult(candidate);
      const envelope = object(result);
      const { content, metadata } = envelope;
      if (typeof content === "string" && Object.hasOwn(envelope, "metadata")) {
        const findings = decodeResult(content);
        if (!findings || typeof findings !== "object" || Array.isArray(findings)) continue;
        result = { metadata, ...findings };
      }
      if (result !== null && typeof result === "object") return { result };
    } catch {
      // Try the final-step content when the shortcut does not contain usable JSON.
    }
  }
  return { issue: hasText ? "returned invalid or unstructured JSON" : "returned no result text" };
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
  const key = process.env.UPSTAGE_API_KEY?.trim();
  if (!key) return error("The server needs an Upstage API key to check this job.", 503);
  const token = new URL(request.url).searchParams.get("run") ?? "";
  const id = readRun(token, key);
  if (!id) return error("This job reference is invalid. Check the job in Studio.", 400);
  try {
    const response = await requestUpstage("/responses/" + id + "?include[]=last", key, {}, 20_000);
    if (!response.ok) return upstreamError(response, "poll");
    const job = object(await response.json());
    if (job.status === "completed") {
      const { result, issue } = readResult(job);
      if (result !== undefined) return reply({ state: "completed", result });
      return error("The job finished and " + issue + ". Check the final step in Upstage Studio for job " + id + ".", 422);
    }
    if (job.status === "cancelled") return error("Upstage cancelled this job.", 422);
    if (job.status === "failed") {
      const failure = object(job.error);
      const code = typeof failure.code === "string" ? failure.code : "";
      const step = typeof failure.step === "string" && stages.includes(failure.step) ? " Step: " + failure.step + "." : "";
      const retryable = ["rate_limit_exceeded", "timeout_error", "server_error"].includes(code);
      const message = Object.hasOwn(failureMessages, code) ? failureMessages[code] : "The workflow failed. Check this run in Studio.";
      return error(message + step, 422, retryable ? { delay: 3 } : {});
    }
    if (typeof job.status !== "string" || !job.status) return error("Upstage returned no job status.", 502, { retry: true });
    return reply({ state: "processing", run: token });
  } catch {
    return error("The status check timed out or could not reach Upstage. The existing job can still be checked.", 504, { retry: true });
  }
}
