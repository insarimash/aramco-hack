"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accept, validateFile, type ReviewResponse } from "../src/review";

const storageKey = "cbam-active-review";
const pending = "pending";

function storeRun(value: string | null) {
  try {
    if (value) sessionStorage.setItem(storageKey, value);
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The current page can still track the job when browser storage is unavailable.
  }
}

function sizeLabel(bytes: number) {
  if (bytes < 1000) return bytes + " B";
  const unit = bytes < 1_000_000 ? 1000 : 1_000_000;
  return (bytes / unit).toLocaleString(undefined, { maximumFractionDigits: 1 }) + (unit === 1000 ? " KB" : " MB");
}

function label(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
}

function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null) return <span>None provided</span>;
  if (typeof value !== "object") return <span>{String(value) || "None provided"}</span>;
  if (depth >= 5) return <pre>{JSON.stringify(value, null, 2)}</pre>;
  if (Array.isArray(value)) return value.length
    ? <ul>{value.map((item, index) => <li key={index}><Value value={item} depth={depth + 1} /></li>)}</ul>
    : <span>None listed</span>;
  const fields = Object.entries(value);
  return fields.length ? <dl>{fields.map(([key, item]) => (
    <div key={key}><dt>{label(key)}</dt><dd><Value value={item} depth={depth + 1} /></dd></div>
  ))}</dl> : <span>No fields returned</span>;
}

const priority = [
  ["decision", "verdict", "validationstatus", "compliancestatus", "status", "valid", "passed", "isvalid", "iscompliant"],
  ["reasons", "reason", "reasoncodes", "summary"],
  ["evidence", "sourcepages", "sources"],
  ["missingdocuments", "missingdocument", "documentsfound"],
  ["nextaction", "nextactions", "recommendations"],
];

function Findings({ result }: { result: unknown }) {
  const fields = result && typeof result === "object" && !Array.isArray(result) ? Object.entries(result) : [];
  const sections = priority.map((aliases) => fields.filter(([key]) => aliases.includes(key.toLowerCase().replace(/[^a-z]/g, ""))));
  const featured = new Set(sections.flat().map(([key]) => key));
  const rest = Object.fromEntries(fields.filter(([key]) => !featured.has(key)));
  return (
    <div className="findings">
      {sections.flatMap((section, group) => section.map(([key, value]) => (
        <section key={key} className={group === 0 ? "decision" : "finding"}>
          <h3>{label(key)}</h3><Value value={value} />
        </section>
      )))}
      {featured.size === 0 ? <Value value={result} /> : Object.keys(rest).length > 0 && (
        <section className="finding"><h3>Other findings</h3><Value value={rest} /></section>
      )}
      <details><summary>View raw JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>
    </div>
  );
}

type Phase = "idle" | "uploading" | "processing" | "paused" | "unknown" | "completed" | "error";

export default function Page() {
  const input = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  const knownFailures = useRef(0);
  const [ready, setReady] = useState(false);
  const [file, setFile] = useState<File>();
  const [validation, setValidation] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number>();
  const [result, setResult] = useState<unknown>();
  const [run, setRun] = useState("");
  const [retryAt, setRetryAt] = useState(0);

  useEffect(() => {
    const restore = setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(storageKey);
        if (saved === pending) {
          setPhase("unknown");
          setMessage("A previous submission may have started a job. Check Upstage Studio before starting another.");
        } else if (saved) {
          setRun(saved);
          setPhase("processing");
        }
      } finally {
        setReady(true);
      }
    }, 0);
    return () => clearTimeout(restore);
  }, []);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);

  useEffect(() => {
    if (phase !== "processing" || !run) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let retries = 0;
    function schedule(ms: number) {
      timer = setTimeout(check, ms);
    }
    async function check() {
      let data: ReviewResponse;
      let status = 0;
      try {
        const response = await fetch("/api/review?run=" + encodeURIComponent(run), { signal: controller.signal });
        status = response.status;
        data = await response.json();
        if (!["processing", "completed", "error"].includes(data.state)) throw new Error("Invalid status");
      } catch {
        data = { state: "error", retry: true, message: "Could not reach the server to check the job." };
      }
      if (controller.signal.aborted) return;
      if (data.state === "processing") {
        retries = 0;
        setMessage("");
        schedule(2500);
      } else if (data.state === "completed") {
        storeRun(null);
        setRun("");
        setResult(data.result);
        knownFailures.current = 0;
        setPhase("completed");
      } else if (status === 422) {
        storeRun(null);
        setRun("");
        if (data.delay) {
          knownFailures.current += 1;
          setRetryAt(Date.now() + Math.min(60, data.delay * 2 ** (knownFailures.current - 1)) * 1000);
        }
        setMessage(data.message);
        setPhase("error");
      } else {
        setMessage(data.message);
        if (data.retry && retries < 4) {
          schedule(Math.max(data.delay ?? 0, 3 * 2 ** retries++) * 1000);
        } else {
          if (data.delay) setRetryAt(Date.now() + data.delay * 1000);
          setPhase("paused");
        }
      }
    }
    schedule(2500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [phase, run]);

  const busy = phase === "uploading" || phase === "processing";
  const canSelect = ready && !busy && phase !== "paused" && phase !== "unknown";

  function choose(next?: File) {
    setValidation(next ? validateFile(next) ?? "" : "");
    setFile(next);
    setPhase("idle");
    setMessage("");
    setResult(undefined);
    knownFailures.current = 0;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSelect || locked.current || !file || validation || retryAt) return;
    locked.current = true;
    storeRun(pending);
    setPhase("uploading");
    setProgress(undefined);
    setMessage("");
    setResult(undefined);

    const body = new FormData();
    body.set("file", file);
    const request = new XMLHttpRequest();
    request.open("POST", "/api/review");
    request.setRequestHeader("X-CBAM-Upload", "1");
    request.responseType = "json";
    request.timeout = 1_200_000;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.floor(100 * event.loaded / event.total));
    };
    request.upload.onload = () => setPhase("processing");

    function finish(data?: ReviewResponse) {
      locked.current = false;
      if (data?.state === "processing") {
        storeRun(data.run);
        setRun(data.run);
        setPhase("processing");
      } else if (data?.state === "error" && !data.unknown) {
        storeRun(null);
        setPhase("error");
        setMessage(data.message);
        if (data.delay) setRetryAt(Date.now() + data.delay * 1000);
      } else {
        setPhase("unknown");
        setMessage(data?.state === "error" ? data.message : "The submission outcome is unknown. Check Upstage Studio before starting another review.");
      }
    }

    request.onload = () => finish(request.response ?? (request.status === 413
      ? { state: "error", message: "The hosting server rejected the upload size." } : undefined));
    request.onerror = request.ontimeout = request.onabort = () => finish();
    request.send(body);
  }

  const status = {
    idle: "Ready for upload",
    uploading: progress === undefined ? "Uploading document" : "Uploading document · " + progress + "%",
    processing: run ? "Checking Upstage workflow" : "Sending document to Upstage",
    paused: "Status check paused",
    unknown: "Submission needs confirmation",
    completed: "Workflow finished",
    error: "Review needs attention",
  }[phase];

  return (
    <>
      <header className="top"><div className="wrap brand"><span className="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M5 18 18 5M7 16C2 11 6 5 19 5c0 13-6 17-11 12"/><path d="M11 12v-3m1 3h4"/></svg></span><span>Aramco Hackathon</span></div></header>
      <main className="wrap">
        <div className="intro"><h1>Fertilizer CBAM review</h1><p>Upload a shipment document and review the findings from your Upstage workflow.</p></div>
        <div className="workspace">
          <section className="panel" aria-labelledby="upload-heading">
            <h2 id="upload-heading">Shipment document</h2>
            <form onSubmit={submit}>
              <div className="file-area">
                <span className="file-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5"/></svg></span>
                <label htmlFor="document">Choose one file</label>
                <input id="document" ref={input} type="file" accept={accept} disabled={!canSelect}
                  aria-describedby="limits formats" aria-invalid={Boolean(validation)}
                  onChange={(event) => {
                    const next = event.currentTarget.files?.[0];
                    if (next) choose(next);
                    event.currentTarget.value = "";
                  }} />
                <p id="limits">Up to 500 MB · 1,000 pages · 10 minutes for video</p>
              </div>
              <details className="formats"><summary>Supported formats</summary><p id="formats">PDF, JPEG, PNG, BMP, TIFF, HEIC, DOCX, PPTX, XLSX, MP4, MOV, M4V, AVI, MKV, WEBM, WMV, FLV, MPG, MPEG, 3GP</p></details>
              {file && <div className="selected"><div><strong>{file.name}</strong><small>{sizeLabel(file.size)}</small></div>
                <button type="button" className="quiet" disabled={!canSelect} onClick={() => { choose(); input.current?.focus(); }}>Remove</button></div>}
              {validation && <p className="notice" role="alert">{validation}</p>}
              <button className="primary" type="submit" disabled={!canSelect || !file || !!validation || !!retryAt}>
                {busy ? "Review in progress" : retryAt ? "Waiting before retry" : phase === "error" ? "Run review again" : "Run CBAM review"}
              </button>
            </form>
          </section>
          <section className="panel results" aria-labelledby="results-heading">
            <h2 id="results-heading">Workflow findings</h2>
            <div className="status" role="status" aria-live="polite"><span className={"dot " + phase} aria-hidden="true" />{status}</div>
            {phase === "idle" && <div className="empty"><p>Your findings will appear here after the workflow finishes.</p></div>}
            {busy && <div className="empty"><p>{message || (run ? "Upstage is reviewing your document. This may take a few minutes." : "Keep this tab open while the document is transferred.")}</p></div>}
            {!busy && message && <p className="notice" role="alert">{message}</p>}
            {phase === "paused" && <button className="secondary" disabled={!!retryAt} onClick={() => { setMessage(""); setPhase("processing"); }}>Resume status checks</button>}
            {phase === "unknown" && <button className="secondary" onClick={() => {
              if (window.confirm("Continue only after checking Studio and resolving any existing job. Enable a new submission?")) {
                storeRun(null); setPhase("idle"); setMessage("");
              }
            }}>I checked Studio</button>}
            {phase === "completed" && <Findings result={result} />}
          </section>
        </div>
      </main>
    </>
  );
}
