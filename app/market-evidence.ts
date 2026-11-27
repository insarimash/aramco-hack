type Metric = { label: string; value: string };
type Market = {
  key: string;
  name: string;
  regulation: string;
  description: string;
  status: string;
  headline?: Metric;
  metrics: Metric[];
  note?: string;
};

const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 8 });
const currency = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

export function marketEvidence(output: Record<string, unknown>): Market[] {
  const numeric = (key: string) => {
    const value = output[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  };
  const amount = (key: string, unit: string) => {
    const value = numeric(key);
    return value === undefined ? undefined : numberFormat.format(value) + " " + unit;
  };
  const text = (key: string) => {
    const value = output[key];
    return typeof value === "string" && value.trim() ? value : undefined;
  };
  const metrics = (rows: [string, string | undefined][]) => rows.flatMap(([label, value]) =>
    value === undefined ? [] : [{ label, value }]);
  const tariff = numeric("final_tariff_eur");
  const intensity = numeric("korea_e_rounded");
  const capture = output.korea_capture_ge_90pct;
  const definitions = [
    {
      key: "eu", name: "EU", regulation: "EU Carbon Border Adjustment Mechanism",
      description: "Review the emissions and coefficient used by the workflow to estimate the shipment’s carbon tariff.",
      status: text("tariff_status"),
      label: "Calculated tariff", value: tariff === undefined ? undefined : currency.format(tariff),
      metrics: metrics([
        ["Net emissions", amount("net_co2_t", "t CO₂")],
        ["Tariff coefficient", amount("tariff_coefficient_eur_per_t", "EUR/t CO₂")],
        ["Total reported emissions", amount("total_co2_emitted_t", "t CO₂")],
        ["CO₂ neutralized", amount("co2_neutralized_t", "t CO₂")],
        ["Gas emissions", amount("gas_co2_t", "t CO₂")],
        ["Electricity emissions", amount("electricity_co2_t", "t CO₂")],
      ]),
    },
    {
      key: "jp", name: "Japan", regulation: "Japan price-gap support screening",
      description: "Review the ammonia emissions intensity and the threshold used for the workflow’s subsidy determination.",
      status: text("japan_determination"),
      label: "Ammonia emissions intensity", value: amount("japan_ci_kg_per_kg_nh3", "kg CO₂e/kg NH₃"),
      metrics: metrics([
        ["Screening threshold", amount("japan_threshold", "kg CO₂e/kg NH₃")],
        ["Net emissions", amount("japan_net_emissions_t", "t CO₂e")],
        ["Upstream emissions", amount("japan_e_up_t", "t CO₂e")],
        ["Gas emissions", amount("japan_e_gas_t", "t CO₂e")],
        ["Electricity emissions", amount("japan_e_el_t", "t CO₂e")],
        ["Captured CO₂ recognized", amount("japan_r_ccs_t", "t CO₂")],
      ]),
      note: text("japan_subsidy_note"),
    },
    {
      key: "kr", name: "South Korea", regulation: "South Korea clean hydrogen grading",
      description: "Review the hydrogen-equivalent emissions intensity, capture test, and clean hydrogen grade returned by the workflow.",
      status: text("korea_grade"),
      label: "Hydrogen emissions intensity", value: intensity === undefined ? undefined : intensity.toFixed(2) + " kg CO₂e/kg H₂",
      metrics: metrics([
        ["Capture test", typeof capture === "boolean" ? (capture ? "Threshold met" : "Below threshold") : undefined],
        ["Capture threshold", amount("korea_capture_90pct_threshold_t", "t CO₂")],
        ["CO₂ deduction recognized", amount("korea_e_co2_sequestered_t", "t CO₂")],
        ["Total emissions", amount("korea_e_total_t", "t CO₂e")],
        ["Hydrogen-equivalent production", amount("korea_h2_equivalent_t", "t H₂")],
        ["KPX grade points", amount("korea_kpx_grade_points", "points")],
      ]),
      note: text("korea_assumptions"),
    },
  ];
  return definitions.flatMap(({ status, label, value, ...market }) =>
    status || value ? [{ ...market, status: status ?? "", headline: value ? { label, value } : undefined }] : []);
}

export function reviewIssues(output: Record<string, unknown>): string[] {
  if (output.status !== "NEEDS_REVIEW") return [];
  const codes = Array.isArray(output.reason_codes) ? output.reason_codes : typeof output.reason_codes === "string" ? output.reason_codes.split(/[,;|]/) : [];
  return codes.flatMap((value) => {
    if (typeof value !== "string" || !value.trim() || value.trim() === "NONE") return [];
    const code = value.trim();
    return [code.startsWith("MISSING_DOC_")
      ? "Missing document · " + code.slice("MISSING_DOC_".length).replace(/_/g, " ").toLowerCase()
      : code.replace(/_/g, " ").toLowerCase()];
  });
}
