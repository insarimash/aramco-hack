function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function outputCandidates(output: unknown): unknown[] {
  if (Array.isArray(output)) return output.slice().reverse().flatMap(outputCandidates);
  if (typeof output === "string") return [output];
  const entry = object(output);
  if (Array.isArray(entry.content)) return outputCandidates(entry.content);
  if (typeof entry.content === "string") return [entry];
  return [entry.output_text, entry.text];
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
  if (typeof parsed !== "string" || isMarkdown(parsed)) return parsed;
  return parseResult(parsed);
}

function isMarkdown(text: string) {
  return /^#{1,6}\s/m.test(text);
}

export function readResult(job: Record<string, unknown>) {
  const candidates = new Set([
    typeof job.content === "string" ? { content: job.content, metadata: job.metadata } : undefined,
    job.output_text,
    ...outputCandidates(Array.isArray(job.output) ? job.output.at(-1) : job.output),
  ]);
  let hasText = false;
  for (const candidate of candidates) {
    if (candidate == null || (typeof candidate === "string" && !candidate.trim())) continue;
    hasText = true;
    try {
      let result = decodeResult(candidate);
      if (typeof result === "string" && isMarkdown(result)) {
        return { result: { content: result, metadata: job.metadata } };
      }
      const envelope = object(result);
      const { content, metadata } = envelope;
      if (typeof content === "string" && Object.hasOwn(envelope, "metadata")) {
        try {
          const findings = decodeResult(content);
          if (findings && typeof findings === "object" && !Array.isArray(findings)) result = { metadata, ...findings };
        } catch {
          if (!content.trim()) continue;
          result = { content, metadata };
        }
      }
      if (result !== null && typeof result === "object") return { result };
    } catch {
      // Try the final-step content when the shortcut does not contain usable JSON.
    }
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && isMarkdown(candidate)) {
      return { result: { content: candidate, metadata: job.metadata } };
    }
  }
  return { issue: hasText ? "returned invalid or unstructured JSON" : "returned no result text" };
}
