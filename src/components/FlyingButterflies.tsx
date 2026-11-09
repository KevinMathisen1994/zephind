const FLYERS = [
  { path: "bf-path-1", size: 72, dur: 38, delay: -6, opacity: 0.6, flap: 3.0, wobble: 2.8 },
  { path: "bf-path-2", size: 110, dur: 52, delay: -20, opacity: 0.42, flap: 3.8, wobble: 3.6 },
  { path: "bf-path-3", size: 150, dur: 64, delay: -34, opacity: 0.3, flap: 4.4, wobble: 4.2 },
  { path: "bf-path-1", size: 56, dur: 44, delay: -27, opacity: 0.5, flap: 2.6, wobble: 2.4 },
];

/** Decorative background: butterflies on slow looping paths, fluttering with bursts of wing beats. */
export default function FlyingButterflies() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {FLYERS.map((f, i) => (
        <div
          key={i}
          className="bf-flyer absolute left-0 top-0"
          style={{ animation: `${f.path} ${f.dur}s ease-in-out ${f.delay}s infinite`, opacity: f.opacity }}
        >
          <div className="bf-wobble" style={{ animationDuration: `${f.wobble}s`, animationDelay: `${-i * 1.3}s` }}>
            <svg
              viewBox="0 0 24 24"
              width={f.size}
              height={f.size}
              fill="white"
              style={{ filter: "drop-shadow(0 0 10px rgba(255,255,255,0.55))" }}
            >
              {[
                ["M11 11C10 6 7 3 3.500 3.500 2.500 6 4 10 8 12c1 .5 2 .2 3-1z", "M10.500 13.500C8 12.500 5 14 5 17c0 2.500 2.500 4 4.500 3 1.500-.8 2-3.500 1-6.500z"],
                ["M13 11c1-5 4-8 7.500-7.500C21.500 6 20 10 16 12c-1 .5-2 .2-3-1z", "M13.500 13.500c2.500-1 5.500.5 5.500 3.500 0 2.500-2.500 4-4.500 3-1.500-.8-2-3.500-1-6.500z"],
              ].map((paths, w) => (
                <g key={w} className="bf-wing" style={{ animationDuration: `${f.flap}s`, animationDelay: `${-i * 0.9}s` }}>
                  {paths.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </g>
              ))}
              <rect x="11.6" y="7" width="0.8" height="12" rx="0.4" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
