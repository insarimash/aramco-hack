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

export function Findings({ result }: { result: unknown }) {
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
