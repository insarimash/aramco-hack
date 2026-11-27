"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { accept, canRecheckResult, validateFile, type ReviewResponse } from "../src/review";
import type { SavedReview } from "../src/local-store";
import Image from "next/image";
import { Findings } from "./findings";
import { badgeClass, Results, reviewStatus } from "./review-results";

const storageKey = "cbam-active-review";
const pending = "pending";
const requiredDocuments = [
  { name: "Monthly Production Report", fields: ["Producer name, installation ID, location, and reporting period", "Production method, product purity, and total monthly ammonia production (tonnes)", "Natural gas feed and fuel use (GJ, LHV), gas emission factor (t CO₂/TJ), and electricity use (MWh)", "Daily production and gas consumption records"] },
  { name: "Bill of Lading", fields: ["Bill of lading and cargo lot numbers", "Shipper, consignee, product description, and CN/HS code", "Cargo quantity (metric tonnes), loading and discharge ports, and shipment date", "Production installation ID and production period"] },
  { name: "Certificate of Origin", fields: ["Certificate number, exporter, and consignee", "Countries of origin and destination, product description, and CN/HS code", "Cargo quantity, producing installation ID, and bill of lading reference"] },
  { name: "Electricity Invoice", fields: ["Supplier, customer, invoice number, billing period, and production facility", "Total electricity use (MWh) and grid emission factor (t CO₂/MWh)", "Renewable energy certificate or power purchase agreement (PPA) status"] },
  { name: "CO₂ Capture & Storage Report", fields: ["Operator, installation ID, reporting period, and CO₂ capture source", "Storage location and method", "CO₂ permanently stored (tonnes) and transferred for utilization, including urea production (tonnes)", "Daily CO₂ measurement records"] },
];

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

type Phase = "idle" | "uploading" | "processing" | "paused" | "unknown" | "completed" | "error";

function Logo() {
  return <div className="logo"><Image src="/kuc-logo.png" width={2172} height={724} alt="KUC — Know Your Carbon" priority /></div>;
}

function Icon({ name }: { name: "review" | "history" | "logout" | "upload" }) {
  const paths = {
    review: "M6 3h8l4 4v14H6z M14 3v5h4 M9 14l2 2 4-4",
    history: "M4 11a8 8 0 1 1 1 5 M4 5v6h6 M12 8v4l3 2",
    logout: "M10 4H4v16h6 M8 12h12m-4-4 4 4-4 4",
    upload: "M12 16V4m-4 4 4-4 4 4M5 15v5h14v-5",
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export default function Page() {
  const [user, setUser] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [reviews, setReviews] = useState<SavedReview[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyReady, setHistoryReady] = useState(false);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [view, setView] = useState<"review" | "history">("review");
  const [savedRun, setSavedRun] = useState<string>();
  const [completedRun, setCompletedRun] = useState("");
  const [evidence, setEvidence] = useState<number | null>(null);
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

  useEffect(() => { fetch("/api/auth").then((response) => response.json()).then((data) => setUser(data.user?.email ?? null)).catch(() => setAuthError("Could not reach the server.")).finally(() => setAuthReady(true)); }, []);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    fetch("/api/history", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("History request failed");
      const data = await response.json();
      if (controller.signal.aborted) return;
      setReviews(data.reviews ?? []);
      setHistoryError("");
      setHistoryReady(true);
    }).catch(() => {
      if (!controller.signal.aborted) setHistoryError("Could not load review history.");
    });
    return () => controller.abort();
  }, [user, phase, view, run, historyAttempt]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setAuthBusy(true); setAuthError(""); setAuthNotice("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: authMode, email, password }) });
      const data = await response.json();
      if (!response.ok) { setAuthError(data.error); return; }
      if (authMode === "register") {
        setAuthMode("login"); setPassword(""); setAuthNotice("Account created. Sign in to continue.");
        return;
      }
      setPassword(""); setView("review"); setUser(data.user.email);
    } catch { setAuthError("Could not reach the server."); }
    finally { setAuthBusy(false); }
  }
  async function signOut() {
    if (locked.current) return;
    try {
      setAuthError("");
      const response = await fetch("/api/auth", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      setUser(null); setReviews([]); setResult(undefined); setRun(""); setPhase("idle"); storeRun(null);
      setReady(false); setFile(undefined); setValidation(""); setMessage(""); setRetryAt(0);
      setSavedRun(undefined); setEvidence(null); setCompletedRun(""); setHistoryReady(false); setHistoryError("");
      knownFailures.current = 0;
    } catch {
      setAuthError("Could not log out. Try again.");
    }
  }

  useEffect(() => {
    if (!authReady || !user) return;
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
      } catch {
        // History can still recover a known run when session storage is unavailable.
      } finally {
        setReady(true);
      }
    }, 0);
    return () => clearTimeout(restore);
  }, [authReady, user]);

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
        setCompletedRun(run);
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
  const submitting = busy && !run;
  const canSelect = ready && !busy && phase !== "paused" && phase !== "unknown";

  function choose(next?: File) {
    setValidation(next ? validateFile(next) ?? "" : "");
    setFile(next);
    setPhase("idle");
    setMessage("");
    setResult(undefined);
    setEvidence(null);
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
    setEvidence(null);

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

  function navigate(next: "review" | "history") {
    setView(next);
    setSavedRun(undefined);
    setEvidence(null);
  }

  function resume(item: SavedReview) {
    if (locked.current) return;
    setFile(undefined);
    setValidation("");
    setResult(undefined);
    setMessage("");
    setRetryAt(0);
    storeRun(item.run);
    setRun(item.run);
    setPhase("processing");
    navigate("review");
  }

  const saved = reviews.find((item) => item.run === savedRun);
  const current = reviews.find((item) => item.run === completedRun);
  const displayed = view === "history" ? saved?.result : phase === "completed" ? result : undefined;
  const displayedFile = view === "history" ? saved : current;
  const activeStep = phase === "completed" ? 2 : run || phase === "processing" ? 1 : 0;

  if (!authReady || !user) return <main className="auth-shell">
    <section className="panel auth-panel">
      <Logo />
      {!authReady ? <p role="status">Loading account…</p> : <>
        <h1>{authMode === "login" ? "Sign in" : "Create account"}</h1>
        <p>Access your carbon compliance reviews.</p>
        <form onSubmit={authenticate}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" minLength={8} maxLength={128} required autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
          {authNotice && <p className="notice" role="status">{authNotice}</p>}
          {authError && <p className="notice" role="alert">{authError}</p>}
          <button className="primary" disabled={authBusy}>{authMode === "login" ? "Sign in" : "Create account"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); setAuthNotice(""); }}>
          {authMode === "login" ? "Need an account? Register" : "Already have an account? Sign in"}
        </button>
      </>}
    </section>
  </main>;

  return <div className={"dashboard" + (evidence !== null && displayed !== undefined ? " with-evidence" : "")}>
    <aside className="sidebar">
      <Logo />
      <nav aria-label="Workspace">
        <button type="button" aria-current={view === "review" ? "page" : undefined} onClick={() => navigate("review")}><Icon name="review" />Review</button>
        <button type="button" aria-current={view === "history" ? "page" : undefined} onClick={() => navigate("history")}><Icon name="history" />History</button>
        <button type="button" disabled={submitting} onClick={signOut}><Icon name="logout" />Log out</button>
      </nav>
      <small className="account-email">{user}</small>
    </aside>
    <main className="main-content">
      {authError && <p className="notice" role="alert">{authError}</p>}
      {view === "review" ? <>
        <header className="page-heading">
          <h1>Carbon compliance review</h1>
          <p>{phase === "completed" ? current?.fileName ?? file?.name ?? "Document review" : "Check shipment documents and inspect the supporting evidence."}</p>
        </header>
        <ol className="steps" aria-label="Review progress">
          {["Upload", "Review data", "Results"].map((step, index) => <li key={step} className={index <= activeStep ? "reached" : ""} aria-current={index === activeStep ? "step" : undefined}>
            <span className="step-circle" aria-hidden="true">{index < activeStep || phase === "completed" ? "✓" : index + 1}</span><span>{step}</span>
          </li>)}
        </ol>
        {phase !== "completed" ? <section className="panel upload-panel" aria-labelledby="upload-heading">
          <h2 id="upload-heading">Upload your cargo document bundle</h2>
          <p>Combine all five documents below into one readable PDF for the same cargo or its associated production facility and period.</p>
          <details className="input-guide" open>
            <summary>What to include in the PDF</summary>
            <div className="document-grid">
              {requiredDocuments.map((document, index) => <section className="document-card" key={document.name}>
                <h3><span aria-hidden="true">{index + 1}</span>{document.name}</h3>
                <ul>{document.fields.map((field) => <li key={field}>{field}</li>)}</ul>
              </section>)}
            </div>
            <div className="consistency-guide">
              <h3>Before you upload</h3>
              <ul>
                <li>Match installation IDs, product codes, shipment references, and cargo quantities across relevant documents.</li>
                <li>Match the production, electricity, and carbon capture reporting periods.</li>
                <li>Clearly distinguish monthly production from the quantity in this cargo.</li>
                <li>Include units for every number. State zero explicitly; do not fill gaps with assumed values.</li>
              </ul>
              <p>Missing documents or required information will make the bundle incomplete, so it cannot receive a definitive compliance or subsidy eligibility assessment.</p>
              <p>Suggested filename: <code>Cargo_Lot_[ID]_documents.pdf</code></p>
            </div>
          </details>
          <form onSubmit={submit}>
            <div className="file-area">
              <span className="file-icon"><Icon name="upload" /></span>
              <label htmlFor="document" className="secondary file-label" aria-disabled={!canSelect}>Choose file</label>
              <input id="document" className="file-input" ref={input} type="file" accept={accept} disabled={!canSelect}
                aria-describedby="limits" aria-invalid={Boolean(validation)} onChange={(event) => {
                  const next = event.currentTarget.files?.[0];
                  if (next) choose(next);
                  event.currentTarget.value = "";
                }} />
              <p id="limits">One PDF containing all five documents · Up to 500 MB · 1,000 pages</p>
            </div>
            {file && <div className="selected"><div><strong>{file.name}</strong><small>{sizeLabel(file.size)}</small></div>
              <button type="button" className="quiet" disabled={!canSelect} onClick={() => { choose(); input.current?.focus(); }}>Remove</button></div>}
            {validation && <p className="notice" role="alert">{validation}</p>}
            <button className="primary" type="submit" disabled={!canSelect || !file || !!validation || !!retryAt}>
              {busy ? "Review in progress" : retryAt ? "Waiting before retry" : phase === "error" ? "Run review again" : "Run review"}
            </button>
          </form>
        </section> : <div className="review-actions">
          <button type="button" className="secondary" onClick={() => { choose(); setCompletedRun(""); }}>New review</button>
          <button type="button" className="secondary" onClick={() => navigate("history")}>View history</button>
        </div>}
        {phase !== "idle" && <div className="run-status">
          <p className="status" role="status">{status}</p>
          {busy && <p>{message || (run ? "Upstage is reviewing your document. This may take a few minutes." : "Keep this tab open while the document is transferred.")}</p>}
          {!busy && message && <p className="notice" role="alert">{message}</p>}
          {phase === "paused" && <button className="secondary" disabled={!!retryAt} onClick={() => { setMessage(""); setPhase("processing"); }}>Resume status checks</button>}
          {phase === "unknown" && <button className="secondary" onClick={() => {
            if (window.confirm("Continue only after checking Studio and resolving any existing job. Enable a new submission?")) {
              storeRun(null); setPhase("idle"); setMessage("");
            }
          }}>I checked Studio</button>}
        </div>}
      </> : <>
        <header className="page-heading"><h1>Review history</h1><p>Open past results or check an unfinished review.</p></header>
        {historyError && <div><p className="notice" role="alert">{historyError}</p><button type="button" className="secondary" onClick={() => setHistoryAttempt((value) => value + 1)}>Retry history</button></div>}
        {saved && <div className="history-detail">
          <button type="button" className="secondary" onClick={() => navigate("history")}>Back to history</button>
          <h2>{saved.fileName}</h2><p>{new Date(saved.createdAt).toLocaleString()}</p>
          {saved.failure && <p className="notice">{saved.failure}</p>}
          {canRecheckResult(saved.failure) && <button className="secondary" disabled={submitting} onClick={() => resume(saved)}>Recheck result</button>}
        </div>}
        {!saved && <section className="panel history" aria-label="Saved reviews">
          {!historyReady && !historyError && <p role="status">Loading reviews…</p>}
          {historyReady && reviews.length === 0 && <p>No saved reviews yet.</p>}
          {reviews.length > 0 && <ul>{reviews.map((item) => {
            const outcome = canRecheckResult(item.failure) ? "Result needs review" : item.failure ? "Run ended" : item.completedAt ? reviewStatus(item.result) : "Processing";
            return <li key={item.run}>
              <div className="history-file"><strong>{item.fileName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div>
              <span className={badgeClass(item.failure ? "failed" : outcome)}>{outcome}</span>
              {item.completedAt ? <button className="secondary" onClick={() => { setSavedRun(item.run); setEvidence(null); }}>{item.failure ? "View details" : "View result"}</button>
                : <button className="secondary" disabled={submitting} onClick={() => resume(item)}>Check run</button>}
            </li>;
          })}</ul>}
        </section>}
      </>}
      {displayed !== undefined && <Results result={displayed} fileName={displayedFile?.fileName ?? file?.name ?? ""}
        sourceUrl={displayedFile?.hasSource ? "/api/review/source?run=" + encodeURIComponent(displayedFile.run) : undefined}
        selected={evidence} onSelect={setEvidence} fallback={<Findings result={displayed} />} />}
    </main>
  </div>;
}
