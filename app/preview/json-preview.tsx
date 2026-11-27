"use client";

import { useState, type FormEvent } from "react";
import { readResult } from "../../src/upstage-result";
import { Findings } from "../findings";
import { fields, Results, reviewStatus } from "../review-results";

export function JsonPreview() {
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<unknown>();
  const [selected, setSelected] = useState<number | null>(null);

  function load(raw: string) {
    setText(raw);
    setMessage("");
    setResult(undefined);
    setSelected(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      // The production parser also handles fenced JSON and worksheet text.
    }
    const job = fields(parsed);
    const wrapped = Object.hasOwn(job, "output") || Object.hasOwn(job, "output_text");
    const decoded = readResult(wrapped ? job : { output_text: raw });
    if (decoded.result === undefined) {
      setMessage("The review parser " + decoded.issue + ".");
      return;
    }
    setResult(decoded.result);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(text);
  }

  return <main className="main-content">
    <header className="page-heading"><h1>Workflow response preview</h1><p>Open a JSON export or paste the workflow response to check Results and Evidence locally.</p></header>
    <form className="panel preview-form" onSubmit={submit}>
      <label htmlFor="response-file">Response file</label>
      <input id="response-file" type="file" accept=".json,.txt,application/json,text/plain" onChange={async (event) => {
        const input = event.currentTarget;
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        try { load(await file.text()); }
        catch { setResult(undefined); setSelected(null); setMessage("Could not read the selected file."); }
      }} />
      <label htmlFor="response-text">Response text</label>
      <textarea id="response-text" rows={8} spellCheck={false} value={text} onChange={(event) => setText(event.target.value)} />
      <button type="submit" className="primary" disabled={!text.trim()}>Preview response</button>
      {message && <p className="notice" role="alert">{message}</p>}
    </form>
    {result !== undefined && <>
      <p className="run-status">History status <strong>{reviewStatus(result)}</strong></p>
      <Results result={result} fileName="" selected={selected} onSelect={setSelected} fallback={<Findings result={result} />} />
    </>}
  </main>;
}
