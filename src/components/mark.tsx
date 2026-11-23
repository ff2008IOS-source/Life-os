import { formatPercent, markPercent, markTone } from "@/lib/display";

/**
 * A colour-coded score: the number itself is green (83%+), orange (70–83%) or
 * red (under 70%). The percentage is always written out, so colour is never
 * the only signal.
 */
export function Mark({
  earned,
  maximum,
  unit = "points",
  showFraction = true,
}: {
  earned: number | null | undefined;
  maximum?: number | null;
  unit?: "points" | "percent";
  showFraction?: boolean;
}) {
  const pct = markPercent(earned, maximum, unit);
  if (pct === null) return null;
  const tone = markTone(pct);
  return (
    <span className={`mark mark-${tone}`}>
      {showFraction && unit === "points" && typeof maximum === "number" && (
        <span className="mark-fraction">
          {earned} / {maximum} ·{" "}
        </span>
      )}
      <b>{formatPercent(pct)}</b>
    </span>
  );
}
