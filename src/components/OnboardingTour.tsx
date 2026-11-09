import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

const DONE_KEY = "zephind:tour-done-v1";
const SPLASH_FLAG = "__zephindSplashActive";

type Step = {
  title: string;
  body: string;
  target?: string; // data-tour value of the element to spotlight
  action?: { label: string; to: string };
};

const STEPS: Step[] = [
  {
    title: "Zephinderへようこそ",
    body: "買主の希望条件を登録すると、全サイトから物件を自動で集めて評価点を付けます。流れを1分で紹介します。",
  },
  {
    title: "① 検索条件を作る",
    body: "まずここから、買主の希望条件（エリア・予算・種別など）を登録します。登録した条件が1件の「検索」になります。",
    target: "new-search",
    action: { label: "作成フォームを開く", to: "/orders?new=1" },
  },
  {
    title: "② 条件を入力して保存",
    body: "エリア、予算、駅徒歩、物件種別、面積、築年数などを設定して保存します。顧客を選んでおくと、後で提案に使えます。",
  },
  {
    title: "③ 検索の一覧",
    body: "保存した検索はここに並びます。検索を開くと、条件に合う物件の一覧が見られます。",
    target: "nav/orders",
  },
  {
    title: "④ 物件を取得する",
    body: "検索ページの「手動検索」を押すと、全サイトからすぐに物件を取得できます。取得は自動でも定期的に動き、新着は「本日の新着」に集まります。",
  },
  {
    title: "⑤ 評価を見る",
    body: "各物件の点数は自動スコア（0〜100点）です。物件を開いて「AIで詳細レポートを生成」を押すと、AIが強み・リスク・提案方針を文章で解説します。点数の計算方法は物件内の「評価の計算方法を見る」で確認できます。",
  },
  {
    title: "⑥ 気になる物件は★で保存",
    body: "物件の★を押すと、ここの「保存物件」に集まります。",
    target: "nav/saved",
  },
  {
    title: "⑦ 顧客に提案する",
    body: "物件にチェックを入れて「顧客へ提案・送信」を押すと、提案を送れます。顧客情報はここで、提案の進み具合は「案件・提案管理」で管理します。",
    target: "nav/customers",
  },
  {
    title: "準備完了です",
    body: "このガイドは、左下の「使い方ガイド」からいつでも見直せます。",
  },
];

const PAD = 8;
const CARD_W = 360;

function readDone() {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return false;
  }
}

export default function OnboardingTour() {
  const navigate = useNavigate();
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const finish = useCallback(() => {
    setStep(null);
    try {
      localStorage.setItem(DONE_KEY, "1");
    } catch {
      /* storage blocked: the guide may show again, which is harmless */
    }
  }, []);

  // First launch: wait for the splash to finish, then start. Replay: header link fires an event.
  useEffect(() => {
    const start = () => setStep(0);
    window.addEventListener("zephind:start-tour", start);
    let t: ReturnType<typeof setTimeout> | undefined;
    if (!readDone()) {
      if ((window as unknown as Record<string, unknown>)[SPLASH_FLAG]) {
        window.addEventListener("zephind:splash-done", start, { once: true });
      } else {
        t = setTimeout(start, 700);
      }
    }
    return () => {
      window.removeEventListener("zephind:start-tour", start);
      window.removeEventListener("zephind:splash-done", start);
      if (t) clearTimeout(t);
    };
  }, []);

  const current = step == null ? null : STEPS[step];

  useLayoutEffect(() => {
    if (!current?.target) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${current.target}"]`);
      const r = el?.getBoundingClientRect();
      // Off-screen (mobile drawer closed) or missing: fall back to a centred card.
      setRect(r && r.width > 0 && r.right > 0 && r.left < window.innerWidth ? r : null);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [current]);

  const next = useCallback(() => {
    setStep((s) => {
      if (s == null) return s;
      if (s >= STEPS.length - 1) {
        finish();
        return null;
      }
      return s + 1;
    });
  }, [finish]);

  useEffect(() => {
    if (step == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") setStep((s) => (s && s > 0 ? s - 1 : s));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, finish, next]);

  if (step == null || !current) return null;

  const isLast = step === STEPS.length - 1;
  const cardStyle: React.CSSProperties = rect
    ? {
        left: Math.min(rect.right + 20, window.innerWidth - CARD_W - 16),
        top: Math.max(16, Math.min(rect.top, window.innerHeight - 320)),
      }
    : { left: "50%", top: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="使い方ガイド">
      {/* Backdrop; the spotlight is a hole made by a huge box-shadow. */}
      {rect ? (
        <div
          className="tour-spot absolute rounded-xl"
          style={{
            left: rect.left - PAD,
            top: rect.top - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      <div
        key={step}
        className="tour-card absolute w-[min(360px,calc(100vw-32px))] rounded-2xl bg-white p-5 shadow-2xl"
        style={cardStyle}
      >
        <div className="mb-2 flex items-center justify-between text-xs font-bold text-[var(--text-muted)]">
          <span>
            {step + 1} / {STEPS.length}
          </span>
          {!isLast && (
            <button type="button" onClick={finish} className="cursor-pointer hover:text-[var(--text-primary)]">
              スキップ
            </button>
          )}
        </div>
        <div className="mb-3 h-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
          <div
            className="h-full rounded-full bg-[var(--brand)] transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
        <h3 className="text-[18px] font-bold text-[var(--text-primary)]">{current.title}</h3>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--text-secondary)]">{current.body}</p>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep(step - 1)}
            className="h-9 cursor-pointer rounded-lg px-3 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-page-subtle)] disabled:invisible"
          >
            戻る
          </button>
          <div className="flex gap-2">
            {current.action && (
              <button
                type="button"
                onClick={() => {
                  navigate(current.action!.to);
                  next();
                }}
                className="h-9 cursor-pointer rounded-lg border border-[var(--brand)] px-3 text-sm font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)]"
              >
                {current.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={next}
              className="h-9 cursor-pointer rounded-lg bg-[var(--brand)] px-4 text-sm font-bold text-white hover:bg-[var(--brand-hover)]"
            >
              {isLast ? "はじめる" : "次へ"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
