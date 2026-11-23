/** Spreadsheet dates arrive as day serials (46391 = Jan 4, 2027) in date columns. */
export function cellText(header: string, value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  if (
    /date|week of|deadline|due/i.test(header) &&
    value !== "" &&
    value !== null &&
    Number.isInteger(n) &&
    n > 30000 &&
    n < 80000
  )
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toLocaleDateString(
      "en-CA",
      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
    );
  return String(value ?? "");
}
