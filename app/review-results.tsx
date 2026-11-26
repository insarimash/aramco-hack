import { Fragment, type ReactNode } from "react";

export function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function title(value: string) {
  if (value.toUpperCase() === "OK") return "OK";
  const words = value.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusOf(text: string) {
  return /\b(?:review[_ ]status|record_status)\b["\x60*]*[ \t]*:[ \t]*["\x60*]*([A-Z][A-Z0-9_-]*)/i.exec(text)?.[1]?.toUpperCase();
}

function recordCases(content: string) {
  const cases = [...content.matchAll(/^#{2,6}[ \t]+((?:Case|Instance)\b[^\r\n]*)\r?$/gim)];
  return cases.length ? cases.map((entry, index) => ({
    name: entry[1],
    text: content.slice(entry.index! + entry[0].length, cases[index + 1]?.index).trim(),
  })) : [{ name: "Document check", text: content.trim() }];
}

export function reviewStatus(result: unknown) {
  const record = fields(result);
  if (typeof record.content === "string") {
    const statuses = [...new Set(recordCases(record.content).map(({ text }) => statusOf(text)))];
    if (statuses.length === 1 && statuses[0]) return title(statuses[0]);
    if (statuses.length > 1) return "Multiple outcomes";
  }
  for (const key of ["review_status", "record_status", "decision", "verdict", "validation_status", "compliance_status", "status"]) {
    if (typeof record[key] === "string") return title(record[key]);
  }
  return "Completed";
}

function inline(line: string) {
  return line.split(/(\`[^\`]+\`|\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <code key={index}>{part.slice(1, -1)}</code> :
    part.startsWith("**") && part.endsWith("**") ? <strong key={index}>{part.slice(2, -2)}</strong> : part
  );
}

function MarkdownProse({ text }: { text: string }) {
  return text.split(/\r?\n(?=\s*\r?\n|#{1,6}\s)/).map((block, index) => {
    const lines = block.trim().split(/\r?\n/).filter((line) => line.trim());
    if (!lines.length) return null;
    const heading = /^#{1,6}\s+(.+)$/.exec(lines[0]);
    const body = heading ? lines.slice(1) : lines;
    const rows = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    const nodes: ReactNode[] = [];
    for (let offset = 0; offset < body.length; offset++) {
      const line = body[offset];
      if (line.trim().startsWith("|") && /^\s*\|[\s|:-]+$/.test(body[offset + 1] ?? "")) {
        const headers = rows(line);
        const data = [];
        offset++;
        while (body[offset + 1]?.trim().startsWith("|")) data.push(rows(body[++offset]));
        nodes.push(<div className="table-scroll" key={offset}><table><thead><tr>{headers.map((cell, column) => <th key={column}>{inline(cell)}</th>)}</tr></thead><tbody>{data.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table></div>);
      } else if (/^\s*[-*]\s/.test(line)) {
        const list = [line];
        while (/^\s*[-*]\s/.test(body[offset + 1] ?? "")) list.push(body[++offset]);
        nodes.push(<ul key={offset}>{list.map((item, itemIndex) => <li key={itemIndex} style={{ marginInlineStart: /^\s{2,}/.test(item) ? "1rem" : undefined }} dir="auto">{inline(item.replace(/^\s*[-*]\s+/, ""))}</li>)}</ul>);
      } else {
        nodes.push(<p key={offset} dir="auto">{inline(line)}</p>);
      }
    }
    return <Fragment key={index}>{heading && <h4>{inline(heading[1])}</h4>}{nodes}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  return text.split(/^[ \t]*```[\w-]*[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*\r?$/m).map((part, index) =>
    index % 2 === 1 ? <pre key={index}><code>{part.trimEnd()}</code></pre> : <MarkdownProse key={index} text={part} />
  );
}

function documentType(text: string) {
  return /\bdocument_type\b["\x60*]*[ \t]*:[ \t]*["\x60*]*([\w-]+)/i.exec(text)?.[1];
}

function sourcesFor(metadata: unknown, text: string, single: boolean) {
  const meta = fields(metadata);
  const type = documentType(text);
  const page = Number(/\bpage_identity\b["\x60*]*[ \t]*:[ \t]*["\x60*]*(?:Page[ \t]+)?([1-9]\d*)\b/i.exec(text)?.[1]);
  const items = fields(meta.merge).items;
  const matching = type && Array.isArray(items) ? items.map(fields).find((item) => item.document_type === type) : undefined;
  const sources = Number.isSafeInteger(page)
    ? meta.source_files ?? matching?.source_files
    : matching?.source_files ?? meta.source_files;
  if (!Array.isArray(sources)) return [];
  return sources.map(fields).flatMap((source) => {
    if (typeof source.file_name !== "string") return [];
    const ranges = Array.isArray(source.page_ranges) ? source.page_ranges : [];
    const pages = ranges.filter((range): range is [number, number] => Array.isArray(range) && range.length === 2 &&
      range.every((page) => Number.isInteger(page) && page > 0));
    if (Number.isSafeInteger(page)) {
      if (pages.length && !pages.some(([start, end]) => start <= page && page <= end)) return [];
      return [{ name: source.file_name, pages: [[page, page]] as [number, number][] }];
    }
    return [{ name: source.file_name, pages: single || matching ? pages : [] }];
  });
}

export function Results({ result, fileName, sourceUrl, selected, onSelect, fallback }: {
  result: unknown; fileName: string; sourceUrl?: string; selected: number | null;
  onSelect: (index: number | null) => void; fallback: ReactNode;
}) {
  const record = fields(result);
  const cases = typeof record.content === "string" && record.content.trim()
    ? recordCases(record.content)
    : [{ name: "Workflow findings", text: "" }];
  const current = selected === null ? undefined : cases[selected];
  const sources = current ? sourcesFor(record.metadata, current.text, cases.length === 1) : [];
  const page = sources[0]?.pages[0]?.[0];
  return <>
    <section className="result-list" aria-labelledby="results-heading">
      <div className="section-heading"><h2 id="results-heading">Results</h2><span>{cases.length} {cases.length === 1 ? "record" : "records"}</span></div>
      {cases.map((item, index) => {
        const type = documentType(item.text);
        const status = statusOf(item.text);
        return <button type="button" className="result-card" key={index} aria-expanded={selected === index} onClick={() => onSelect(selected === index ? null : index)}>
          <span className="result-icon" aria-hidden="true">✓</span>
          <span className="result-name"><strong>{type ? title(type) : item.name}</strong>{type && <small>{item.name}</small>}</span>
          <span className={badgeClass(status ?? reviewStatus(result))}>{status ? title(status) : item.text ? "View findings" : reviewStatus(result)}</span>
          <span className="chevron" aria-hidden="true" />
        </button>;
      })}
    </section>
    {current && <aside className="evidence" aria-labelledby="evidence-heading">
      <div className="evidence-heading"><h2 id="evidence-heading">Evidence</h2><button type="button" className="icon-button" aria-label="Close evidence" onClick={() => onSelect(null)}>×</button></div>
      <div className="evidence-body">
        <div className="source-info">
          {(sources.length ? sources : fileName ? [{ name: fileName, pages: [] }] : []).map((source, index) =>
            <div key={index}><strong>{source.name}</strong>{source.pages.length > 0 && <small>{source.pages.length === 1 && source.pages[0][0] === source.pages[0][1] ? "Page " : "Pages "}{source.pages.map(([start, end]) => start === end ? start : start + "–" + end).join(", ")}</small>}</div>)}
          {sourceUrl && <a href={sourceUrl + (page && /\.pdf$/i.test(fileName) ? "#page=" + page : "")} target="_blank" rel="noreferrer">Open source document</a>}
        </div>
        <div className="record-content" dir="auto">{current.text ? <Markdown text={current.text} /> : fallback}</div>
        {current.text && <details className="raw"><summary>View raw JSON</summary><pre>{JSON.stringify(result, null, 2)}</pre></details>}
      </div>
    </aside>}
  </>;
}

export function badgeClass(status?: string) {
  const value = status?.toLowerCase() ?? "";
  if (/fail|cancel|reject/.test(value)) return "badge negative";
  if (/note|pending|process|review|multiple/.test(value)) return "badge caution";
  if (value === "ok" || /pass|complete/.test(value)) return "badge positive";
  return "badge";
}
