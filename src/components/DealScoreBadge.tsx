import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { DealSignal, Doc } from "../lib/dataModel";

const DAY_MS = 24 * 60 * 60 * 1000;

export function getListingDealScore(
  listing: Doc<"listings"> | undefined,
  match?: Doc<"matching">,
): number | undefined {
  const s = listing?.dealScore ?? match?.dealScore;
  return typeof s === "number" && Number.isFinite(s) ? s : undefined;
}

export function getListingDealSignals(
  listing: Doc<"listings"> | undefined,
  match?: Doc<"matching">,
): DealSignal[] {
  const arr = listing?.dealSignals ?? match?.dealSignals;
  return Array.isArray(arr) ? arr : [];
}

export function getListingDealFlags(
  listing: Doc<"listings"> | undefined,
  match?: Doc<"matching">,
): string[] {
  const arr = listing?.dealFlags ?? match?.dealFlags;
  return Array.isArray(arr) ? arr : [];
}

/**
 * 値下げ交渉候補: signal (d) 売り急ぎ is high (>= 0.5) AND on market 90+ days.
 */
export function isNegotiationCandidate(
  listing: Doc<"listings"> | undefined,
  match?: Doc<"matching">,
  now = Date.now(),
): boolean {
  if (!listing?.postedAt) return false;
  const domDays = (now - listing.postedAt) / DAY_MS;
  if (domDays < 90) return false;

  const signals = getListingDealSignals(listing, match);
  const sigD = signals.find((s) => s.key === "d");
  if (sigD) return sigD.value >= 0.5;
  return Boolean(listing.priceDropped) || domDays >= 106;
}

export function DealScoreBadge({
  listing,
  match,
  compact = false,
}: {
  listing: Doc<"listings"> | undefined;
  match?: Doc<"matching">;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const score = getListingDealScore(listing, match);
  const signals = getListingDealSignals(listing, match);
  const flags = getListingDealFlags(listing, match);

  if (score == null && flags.length === 0) return null;

  const rounded = score != null ? Math.round(score) : null;
  const tone =
    rounded == null
      ? ""
      : rounded >= 75
        ? "bg-emerald-600 text-white"
        : rounded >= 60
          ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
          : rounded >= 45
            ? "bg-amber-50 text-amber-800 border border-amber-200"
            : "bg-slate-100 text-slate-600 border border-slate-200";

  return (
    <div
      className="flex flex-col gap-1.5 w-full"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {rounded != null && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (signals.length > 0) setOpen((v) => !v);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12.5px] font-bold transition-all ${tone} ${
              signals.length > 0 ? "cursor-pointer hover:opacity-90" : "cursor-default"
            }`}
            title="割安度・お買い得スコア（クリックで内訳を表示）"
          >
            <Sparkles className="w-3 h-3 shrink-0" />
            <span>お買い得 {rounded}点</span>
            {signals.length > 0 &&
              (open ? (
                <ChevronUp className="w-3 h-3 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 shrink-0" />
              ))}
          </button>
        )}

        {flags.map((flag, i) => (
          <span
            key={`${flag}-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-bold bg-rose-50 text-rose-700 border border-rose-200"
            title={flag}
          >
            <AlertTriangle className="w-3 h-3 shrink-0 text-rose-600" />
            <span>{flag}</span>
          </span>
        ))}
      </div>

      {open && signals.length > 0 && !compact && (
        <div className="mt-0.5 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-[12.5px] text-slate-700 space-y-1">
          {signals.map((s) => (
            <div key={s.key} className="flex items-start justify-between gap-3">
              <span className="font-semibold text-slate-800 shrink-0">
                {s.label}
              </span>
              <span className="text-slate-600 flex-1">{s.reason}</span>
              <span className="font-mono text-[11.5px] font-bold text-slate-500 shrink-0">
                {Math.round(s.value * 100)}点 (重み{s.weight})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
