import { useEffect, useState } from "react";

const KEY = "zephind:splash-at";
const GAP_MS = 2 * 60 * 60 * 1000;
const SHOW_MS = 4000;

// Only the first launch in 2 hours. Storage can throw (private mode), then skip it.
let decided: boolean | undefined; // one decision per page load (StrictMode renders twice)
function shouldShow() {
  if (decided !== undefined) return decided;
  decided = check();
  return decided;
}
function check() {
  try {
    const last = Number(localStorage.getItem(KEY));
    if (last && Date.now() - last < GAP_MS) return false;
    localStorage.setItem(KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

const SPARKS = Array.from({ length: 16 }, (_, i) => i * 22.5);

/** force: play regardless of the 2-hour rule (used right after a login). */
export default function SplashScreen({ force = false }: { force?: boolean }) {
  const [phase, setPhase] = useState<"in" | "out" | "gone">(() => {
    let show = force;
    if (force) {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* storage blocked: still play */
      }
    } else {
      show = shouldShow();
    }
    // The onboarding tour waits for this flag to clear.
    if (show) (window as unknown as Record<string, unknown>).__zephindSplashActive = true;
    return show ? "in" : "gone";
  });
  useEffect(() => {
    if (phase !== "gone") return;
    const w = window as unknown as Record<string, unknown>;
    if (w.__zephindSplashActive) {
      w.__zephindSplashActive = false;
      window.dispatchEvent(new Event("zephind:splash-done"));
    }
  }, [phase]);
  useEffect(() => {
    if (phase !== "in") return;
    const a = setTimeout(() => setPhase("out"), SHOW_MS);
    const b = setTimeout(() => setPhase("gone"), SHOW_MS + 600);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (phase === "gone") return null;

  return (
    <div
      onClick={() => setPhase("gone")}
      className={`splash fixed inset-0 z-[100] flex cursor-pointer flex-col items-center justify-center overflow-hidden bg-[#161a17] ${
        phase === "out" ? "splash-out" : ""
      }`}
      role="presentation"
    >
      <div className="splash-glow" aria-hidden />
      <div className="relative flex h-40 w-40 items-center justify-center">
        {[0, 0.5, 1].map((d) => (
          <span key={d} className="splash-ring" style={{ animationDelay: `${0.8 + d}s` }} aria-hidden />
        ))}
        {SPARKS.map((a, i) => (
          <span
            key={a}
            className="splash-spark"
            style={{ "--a": `${a}deg`, "--d": `${96 + (i % 3) * 26}px`, animationDelay: `${0.9 + (i % 5) * 0.28}s` } as React.CSSProperties}
            aria-hidden
          />
        ))}
        <svg viewBox="0 0 24 24" className="splash-fly relative h-32 w-32" fill="url(#splash-grad)" aria-hidden>
          <defs>
            <linearGradient id="splash-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#e6f4e3" />
              <stop offset="1" stopColor="#7fb27f" />
            </linearGradient>
          </defs>
          <g className="splash-wing-l">
            <path d="M11 11C10 6 7 3 3.500 3.500 2.500 6 4 10 8 12c1 .5 2 .2 3-1z" />
            <path d="M10.500 13.500C8 12.500 5 14 5 17c0 2.500 2.500 4 4.500 3 1.500-.8 2-3.500 1-6.500z" />
          </g>
          <g className="splash-wing-r">
            <path d="M13 11c1-5 4-8 7.500-7.500C21.500 6 20 10 16 12c-1 .5-2 .2-3-1z" />
            <path d="M13.500 13.500c2.500-1 5.500.5 5.500 3.500 0 2.500-2.500 4-4.500 3-1.500-.8-2-3.500-1-6.500z" />
          </g>
        </svg>
      </div>
      <h1 className="mt-8 flex text-[40px] font-bold tracking-[-0.01em] text-white" aria-label="Zephinder">
        {"Zephinder".split("").map((ch, i) => (
          <span key={i} className="splash-letter" style={{ animationDelay: `${1.1 + i * 0.07}s` }} aria-hidden>
            {ch}
          </span>
        ))}
      </h1>
      <p className="splash-tagline mt-3 font-mono text-[12.5px] uppercase text-emerald-400">Property Intelligence</p>
      <div className="splash-bar" aria-hidden />
    </div>
  );
}
