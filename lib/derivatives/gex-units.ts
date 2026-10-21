export type GexUnit = "usd_per_1pct" | "usd_per_point";

export const GEX_UNIT_OPTIONS: { value: GexUnit; label: string; short: string }[] = [
  { value: "usd_per_1pct", label: "Dollar gamma per 1% move", short: "$ / 1%" },
  { value: "usd_per_point", label: "Dollar gamma per 1 point move", short: "$ / pt" },
];

export function gexUnitLabel(unit: GexUnit): string {
  return GEX_UNIT_OPTIONS.find((u) => u.value === unit)?.label ?? unit;
}
