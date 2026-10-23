import { Slider } from "@base-ui/react/slider";
import type { ReactNode } from "react";

/**
 * Sliders for the numeric search conditions, in place of bare number inputs.
 *
 * WHY THE NUMBER BOX STAYS
 * ------------------------
 * A slider is the fast way to say "roughly 5,000万 to 1億", but property
 * conditions are also quoted exactly ("上限1億2,800万"), and a step size that
 * makes dragging pleasant cannot also express every exact figure. So each
 * control keeps a small editable box: drag for the rough range, type when the
 * buyer gave a precise number. Typing accepts values beyond the slider's max
 * too — the slider's max is a comfortable default, not a limit on the business.
 *
 * Empty means "指定なし" (no constraint) and is NOT the same as 0: a 0 lower
 * bound would still be sent to the matcher as a real filter. The value stays a
 * string for exactly this reason — the form and the mutation already treat ""
 * as undefined.
 */

const trackClass =
  "relative h-1.5 w-full rounded-full bg-[var(--border-subtle)] select-none";
const indicatorClass = "rounded-full bg-[var(--brand)]";
// With neither bound set, both thumbs rest at the ends and a filled bar would
// read as "the whole range is selected" when it actually means 指定なし. Keep the
// track empty until the control carries a real constraint.
const indicatorUnsetClass = "rounded-full bg-transparent";
const thumbClass =
  "size-4 rounded-full bg-white border-2 border-[var(--brand)] shadow-sm transition-transform " +
  "hover:scale-110 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[var(--brand)]/25 " +
  "active:scale-105 cursor-grab active:cursor-grabbing";

/** `""` (指定なし) or a number, as the form stores it. */
type Val = string;

function toNumber(value: Val, fallback: number): number {
  const n = Number(value);
  return value !== "" && Number.isFinite(n) ? n : fallback;
}

/** Compact number box shown next to a slider. */
function NumberBox({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: Val;
  onChange: (next: Val) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 w-24 rounded-lg border border-[var(--border-default)] bg-white px-2 text-right text-sm font-bold text-[var(--text-primary)] tabular-nums placeholder:font-medium placeholder:text-[var(--text-placeholder)] focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(26,113,0,0.1)] focus:outline-none"
    />
  );
}

function Header({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-bold text-slate-700">{label}</span>
        {children}
      </div>
      {/* The hint line is ALWAYS laid out, even when empty. Sliders sit side by
          side in a grid, and a hint on one of them alone pushed its track a line
          lower than its neighbour's — reserving the row keeps the tracks aligned
          whatever text each one carries. */}
      <p className="min-h-[17px] text-[14px] font-medium text-slate-500 leading-relaxed">
        {hint}
      </p>
    </div>
  );
}

/** Formats the slider's own bounds, e.g. "0" and "10,000". */
const fmt = (n: number) => n.toLocaleString();

export interface RangeSliderProps {
  label: ReactNode;
  hint?: ReactNode;
  unit: string;
  /** Slider maximum. Typed values may exceed it. */
  max: number;
  step?: number;
  minValue: Val;
  maxValue: Val;
  onMinChange: (next: Val) => void;
  onMaxChange: (next: Val) => void;
  minPlaceholder?: string;
  maxPlaceholder?: string;
}

/**
 * Two-thumb slider for a min–max pair. Left end is 0, right end is `max`.
 *
 * An untouched lower thumb sits at 0 and an untouched upper thumb at `max`,
 * which is what "指定なし" looks like on a slider — but neither is written into
 * the form until the user actually moves it, so an untouched control still
 * submits nothing.
 */
export function RangeSlider({
  label,
  hint,
  unit,
  max,
  step = 1,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  minPlaceholder = "指定なし",
  maxPlaceholder = "指定なし",
}: RangeSliderProps) {
  const unset = minValue === "" && maxValue === "";
  const low = toNumber(minValue, 0);
  // Clamp only for DISPLAY: a typed 15億 on a 10億 slider parks the thumb at the
  // right end rather than throwing the control out of range.
  const high = Math.min(toNumber(maxValue, max), max);
  const value: readonly number[] = [Math.min(low, high), high];

  return (
    <div className="space-y-2.5">
      <Header
        label={label}
        hint={hint}
      >
        <div className="flex items-center gap-1.5">
          <NumberBox
            value={minValue}
            onChange={onMinChange}
            placeholder={minPlaceholder}
            ariaLabel={`最小値 (${unit})`}
          />
          <span className="text-xs font-bold text-slate-400">〜</span>
          <NumberBox
            value={maxValue}
            onChange={onMaxChange}
            placeholder={maxPlaceholder}
            ariaLabel={`最大値 (${unit})`}
          />
          <span className="text-xs font-semibold text-slate-500">{unit}</span>
        </div>
      </Header>

      <Slider.Root
        value={value}
        min={0}
        max={max}
        step={step}
        onValueChange={(next) => {
          const [nextLow, nextHigh] = next as readonly number[];
          // Only write a bound that is actually a constraint: dragging the lower
          // thumb back to 0 or the upper thumb to the far right means "no limit",
          // and must clear the field rather than store 0 / the slider's max.
          onMinChange(nextLow <= 0 ? "" : String(nextLow));
          onMaxChange(nextHigh >= max ? "" : String(nextHigh));
        }}
      >
        <Slider.Control className="flex w-full touch-none items-center py-1.5">
          <Slider.Track className={trackClass}>
            <Slider.Indicator
              className={unset ? indicatorUnsetClass : indicatorClass}
            />
            <Slider.Thumb index={0} className={thumbClass} />
            <Slider.Thumb index={1} className={thumbClass} />
          </Slider.Track>
        </Slider.Control>
      </Slider.Root>

      <div className="flex justify-between text-[13.5px] font-semibold text-slate-400 tabular-nums">
        <span>0</span>
        <span>
          {fmt(max)}
          {unit}
          {"以上"}
        </span>
      </div>
    </div>
  );
}
