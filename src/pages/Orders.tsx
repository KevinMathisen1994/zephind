import { useState, useRef, useEffect, useMemo } from "react";
// Aliased so the call sites below read unchanged. useAction and useMutation
// are the same hook now: both just POST to the backend.
import {
  useApiQuery as useQuery,
  useApiMutation as useMutation,
  useApiMutation as useAction,
} from "../hooks/useApi";
import { api } from "../lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { RangeSlider } from "../components/ui/range-slider";
import {
  formatJaDate,
  formatJaDateTime,
  formatJaDateTimeShort,
  formatJaTime,
} from "../lib/dateFormat";
import { TOKYO_WARDS, TOKYO_CITIES, wardLabelToCode } from "../lib/tokyoWards";
import {
  RefreshCw,
  Mail,
  Plus,
  X,
  Trash2,
  MapPin,
  Train,
  Ruler,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Play,
  Edit,
  Building2,
  FileCheck2,
  SlidersHorizontal,
  CheckCircle2,
  ArrowUpRight,
  FileText,
  ChevronLeft,
  ChevronRight,
  Users,
  Send,
  Clock,
  Bot,
  Cloud,
  Laptop,
  Star,
  Paperclip,
  AlertTriangle,
  TrendingDown,
  Search,
  Sparkles,
  ArrowUpDown,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUser } from "@clerk/clerk-react";
import { ProposalModal } from "../components/ProposalModal";
import type { Doc, Id } from "../lib/dataModel";

const GMAPS_KEY = import.meta.env
  .VITE_NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string;

/**
 * The ローカル runner drives the scraper on THIS machine (`npm run dev:scraper`),
 * so it can only ever work when the app itself is served from localhost. On a
 * deployed origin the option would just produce connection errors, so it is
 * hidden there and the runner is pinned to GitHub Actions.
 */
const IS_LOCALHOST =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "::1", "[::1]"].includes(window.location.hostname);

/**
 * Where the LOCAL scraper service listens (`npm run dev:scraper`).
 *
 * Only ever used when the user explicitly picks ローカル execution, which is why
 * this being a build-time value is fine here — unlike the old code that sent every
 * user's scrape to their own localhost by default and so was dead everywhere but
 * one laptop (see dispatchScrape).
 *
 * 127.0.0.1, NOT localhost, and deliberately so: "localhost" resolves to ::1
 * first, so ANY other process holding [::1]:3001 shadows the scraper even though
 * the scraper is listening on all interfaces. That happened here — an unrelated
 * webpack dev server on [::1]:3001 swallowed every request and the UI could only
 * report "Failed to fetch". Pinning IPv4 addresses the actual listener.
 */
const LOCAL_SCRAPER_URL =
  (import.meta.env.VITE_SCRAPER_URL as string) || "http://127.0.0.1:3001";

/** Where a scrape actually executes. */
type ScrapeRunner = "github" | "local";

/** One row from mailIngest.inspectRecentMail (temporary diagnostic). */
type InspectedMail = {
  provider: string;
  id: string;
  subject?: string;
  from?: string;
  receivedAt?: number;
  bodyText?: string;
  attachments?: { id?: string; filename: string; mimeType: string; size: number }[];
  pdfTexts?: string[];
  listings?: Record<string, unknown>[];
  needsLlm?: boolean;
  reason?: string;
  filtered?: boolean;
  filterReason?: string | null;
  error?: string;
  /** Which path produced `listings`. Absent unless the AI pass was run. */
  engine?: "rules" | "gemini" | "groq" | "none" | "stored";
};

// Mirrors the comp shape built in convex/evaluate.js (MLIT XIT001 fields,
// normalized). Kept loose (`scoreDetail` is stored as `v.any()`) since it's
// diagnostic data, not something the app branches on.
type ComparableTrade = {
  price: number;
  area?: number | null;
  pricePerSqm?: number | null;
  district?: string;
  station?: string;
  walkMinutes?: string;
  buildYear?: string;
  period?: string;
};

type EvaluationScoreDetail = {
  marketAvgPrice?: number | null;
  marketAvgPricePerSqm?: number | null;
  listingPricePerSqm?: number | null;
  amenityCount?: number | null;
  comparables?: ComparableTrade[];
  dataWarnings?: string[];
  [key: string]: unknown;
};

// Every source cli.ts knows about (scraper-service/src/services/scraperRegistry.ts
// KNOWN_SOURCES). Sent as the workflow's `sources` input for 一括取得; leaving it
// empty would fall through to the workflow's curated 6-source default instead.
const ALL_SCRAPE_SOURCES = [
  "athome",
  "hatomark",
  "kenbiya",
  "rakuten",
  "suumo",
  "homes",
  "nomu",
  "nomu_pro",
  "mitsui",
  "stepon",
  "tokyu",
  "mizuho",
  "mitsubishi_ufj",
  "odakyu",
  "keio",
  "haseko",
  "daikyo",
  "tokyotatemono",
  "asahi",
];

const SOURCE_LABELS: Record<string, string> = {
  athome: "At Home",
  suumo: "SUUMO",
  homes: "LIFULL HOME'S",
  hatomark: "鳩マーク",
  kenbiya: "健美家",
  rakuten: "楽天不動産",
  nomu: "ノムコム",
  nomu_pro: "ノムコム・プロ",
  mitsui: "三井のリハウス",
  stepon: "住友不動産ステップ",
  tokyu: "東急リバブル",
  mizuho: "みずほ不動産販売",
  mitsubishi_ufj: "三菱UFJ不動産販売",
  odakyu: "小田急不動産仲介",
  keio: "京王不動産仲介",
  asahi: "朝日住宅",
  haseko: "長谷工の仲介",
  daikyo: "大京穴吹不動産",
  tokyotatemono: "東京建物不動産販売",
};

// All 23 special wards, used when an order names no area at all.
const ALL_TOKYO_WARD_CODES = [
  "13101",
  "13102",
  "13103",
  "13104",
  "13105",
  "13106",
  "13107",
  "13108",
  "13109",
  "13110",
  "13111",
  "13112",
  "13113",
  "13114",
  "13115",
  "13116",
  "13117",
  "13118",
  "13119",
  "13120",
  "13121",
  "13122",
  "13123",
];

/**
 * The label scraper-service/src/cli.ts writes as 実行者 for the scheduled sweep.
 * Must stay in sync with AUTOMATIC_TRIGGER_LABEL there; a mismatch only costs the
 * badge styling, never the text, so it fails soft.
 */
const AUTOMATIC_TRIGGER_LABEL = "自動取得（定期実行）";
const isAutomaticTrigger = (by: string | undefined) =>
  by === AUTOMATIC_TRIGGER_LABEL || /自動/.test(by ?? "");

/**
 * 物件種別, grouped so each row shows what belongs with what: オーナーチェンジ is a
 * property OF a 区分マンション, and 一棟マンション / アパート / ビル are all
 * whole-building purchases — a different product from a single unit.
 */
const PROPERTY_TYPE_GROUPS: {
  label: string;
  types: string[];
  ownerChangeToggle?: boolean;
}[] = [
  { label: "土地・戸建て", types: ["土地", "一戸建て"] },
  {
    label: "マンション（区分）",
    types: ["マンション"],
    ownerChangeToggle: true,
  },
  { label: "一棟・事業用", types: ["ビル", "一棟マンション", "アパート"] },
];

/**
 * 借りる's version of the above. 土地/ビル/一棟マンション are for-sale product
 * shapes (raw land, a whole building bought as an investment) that nobody
 * searches for as a TENANT, and オーナーチェンジ (賃貸中のまま売却) only means
 * anything for a SALE — a rental listing is already occupiable, that concept
 * does not apply to it at all.
 */
const RENTAL_PROPERTY_TYPE_GROUPS: typeof PROPERTY_TYPE_GROUPS = [
  { label: "種別", types: ["一戸建て", "アパート", "マンション"] },
];

/** Types that are a building someone lives in or rents out (i.e. not raw land). */
const BUILDING_TYPES = [
  "一戸建て",
  "マンション",
  "一棟マンション",
  "アパート",
  "ビル",
];
/** Types where a plot size / 建ぺい率 / 容積率 is a meaningful condition. */
const LAND_TYPES = ["土地", "一戸建て", "ビル", "一棟マンション", "アパート"];
/** Types bought for rental income, where 利回り applies. */
const INCOME_TYPES = ["マンション", "一棟マンション", "アパート", "ビル"];

/**
 * Sort options for the extracted-listings list inside an order card.
 *
 * 掲載日 (postedAt) is the portal's own publication date, scraped per listing
 * (scraper-service/src/services/postedDate.ts). Three portals publish no date at
 * all and At Home blocks the page that carries it, so it falls back to 取得日時
 * (`_creationTime`, when this system first saw the listing) — which is also a
 * sort option in its own right, since "when did we search" is a different
 * question from "when was it posted".
 */
const SORT_OPTIONS = [
  { key: "newest", label: "掲載が新しい順" },
  { key: "score", label: "評価スコア順" },
  { key: "oldest", label: "掲載が古い順" },
  { key: "foundNewest", label: "取得日時が新しい順" },
  { key: "priceAsc", label: "価格が安い順" },
  { key: "priceDesc", label: "価格が高い順" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["key"];

/**
 * Quick filters for a long results list, shown as counted chips left of 並び順.
 *
 * Each is a predicate over (match, listing) rather than a fixed list of values, so
 * the chip row can show live counts and hide anything with none — a chip reading
 * "0件" is just noise, and one that filters to an empty list is a dead end.
 *
 * 物件種別 chips are generated from what the results actually contain (see
 * buildTypeFilters) instead of being hard-coded, so they match the order's own
 * criteria without a second list to maintain.
 */
type ListingFilter = {
  key: string;
  label: string;
  test: (
    match: Doc<"matching">,
    listing: Doc<"listings"> | undefined,
    score?: number,
  ) => boolean;
};

/** 14 days, the window the portals themselves treat as 新着. */
const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const BASE_FILTERS: ListingFilter[] = [
  {
    key: "recentMatch",
    label: "⚡ 本日の新着",
    test: (m) =>
      m?._creationTime != null &&
      Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
  },
  {
    key: "highScore",
    label: "高評価 80点以上",
    test: (_m, _l, score) => score !== undefined && score >= 80,
  },
  {
    key: "unevaluated",
    label: "未評価",
    test: (_m, _l, score) => score === undefined,
  },
  {
    key: "new",
    label: "ポータル新着",
    // The portal's own badge, or a posted date inside the same window. Discovery
    // time is deliberately NOT used: everything is "new" on a first sweep.
    test: (_m, listing) =>
      Boolean(listing?.isNew) ||
      (listing?.postedAt != null &&
        Date.now() - listing.postedAt <= NEW_WINDOW_MS),
  },
  {
    key: "hasPostedDate",
    label: "掲載日あり",
    test: (_m, listing) => listing?.postedAt != null,
  },
];

/** 掲載日 if the portal published one, else when we first saw the listing. */
function listingDate(listing: Doc<"listings"> | undefined): number | undefined {
  return listing?.postedAt ?? listing?._creationTime;
}

/**
 * Portals that publish no 掲載日/更新日 at all (verified against their live detail
 * pages), plus At Home, whose detail pages answer with a bot check. Mirrors
 * DETAIL_DATE_SOURCES in scraper-service/src/services/postedDate.ts — kept as a
 * separate list because the frontend cannot import from that package.
 */
const SOURCES_WITHOUT_POSTED_DATE = new Set([
  "stepon",
  "tokyu",
  "asahi",
  "athome",
]);

/**
 * The PORTAL's own date for a listing — when it was posted (or last updated).
 *
 * Deliberately does NOT fall back to `_creationTime`: that is when our search
 * found the listing, it is displayed in its own field right next to this one, and
 * substituting it here printed the same date twice under two different labels.
 * An unknown posted date stays unknown.
 */
function describePostedDate(listing: Doc<"listings"> | undefined): {
  label: string;
  value: number | undefined;
  note: string;
  missingReason?: "unpublished" | "notFetched";
} {
  if (listing?.postedAt == null) {
    // "The portal never publishes one" and "we have not looked yet" are different
    // facts, and showing 非公開 for both was simply wrong for the 15 portals that
    // DO publish a date. A listing found before 掲載日 scraping existed has no
    // date until a run backfills it.
    const unpublished = SOURCES_WITHOUT_POSTED_DATE.has(listing?.source ?? "");
    return {
      label: "掲載日",
      value: undefined,
      missingReason: unpublished ? "unpublished" : "notFetched",
      note: unpublished
        ? "この掲載元は掲載日・更新日を公開していないため取得できません（東急リバブル・住友不動産ステップ・朝日住宅・At Home）"
        : "この物件は掲載日の取得前に登録されました。次回の検索時に掲載元ページから取得します。",
    };
  }
  if (listing.postedDateKind === "updated") {
    return {
      label: "情報更新日",
      value: listing.postedAt,
      note: "この掲載元が公開しているのは更新日のみです。再掲載・情報更新の日付で、初回掲載日とは異なる場合があります。",
    };
  }
  return {
    label: "掲載日（情報公開日）",
    value: listing.postedAt,
    note: "掲載元が公開している情報公開日です。",
  };
}

/**
 * The chip row for one order's results: すべて, each 物件種別 present, then the
 * base filters — each with its real count, and only when that count is non-zero.
 */
function buildListingFilters(
  matches: Doc<"matching">[],
  listingOf: (id: string) => Doc<"listings"> | undefined,
  scoreOf: (match: Doc<"matching">) => number | undefined,
): { key: string; label: string; count: number }[] {
  const rows = matches.map((m) => ({
    match: m,
    listing: listingOf(m.listingId ?? ""),
    score: scoreOf(m),
  }));

  // 物件種別 chips come from the data: portals emit labels the order never named
  // (区分マンション, 売地 …), and a hard-coded list would either miss them or show
  // empty chips.
  const typeCounts = new Map<string, number>();
  for (const row of rows) {
    const type = row.listing?.propertyType;
    if (type) typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  const chips = [{ key: "all", label: "すべて", count: rows.length }];

  for (const [type, count] of [...typeCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    chips.push({ key: `type:${type}`, label: type, count });
  }

  for (const filter of BASE_FILTERS) {
    const count = rows.filter((row) =>
      filter.test(row.match, row.listing, row.score),
    ).length;
    if (count > 0) chips.push({ key: filter.key, label: filter.label, count });
  }

  // One chip that selects everything is not a filter — drop the row entirely.
  return chips.length > 1 ? chips : [];
}

/** Does a match pass the chip the user picked? */
function passesListingFilter(
  filterKey: string,
  match: Doc<"matching">,
  listing: Doc<"listings"> | undefined,
  score: number | undefined,
): boolean {
  if (!filterKey || filterKey === "all") return true;
  if (filterKey.startsWith("type:")) {
    return listing?.propertyType === filterKey.slice("type:".length);
  }
  const filter = BASE_FILTERS.find((f) => f.key === filterKey);
  return filter ? filter.test(match, listing, score) : true;
}

/** Score on a match: the stored value, else parsed out of the evaluation text. */
function matchScore(
  match: Doc<"matching">,
  localEvaluations: Record<string, string>,
): number | undefined {
  if (match.score != null) return match.score;
  const text = match.evaluation || localEvaluations[match._id];
  const parsed = text?.match(/評価[：:\s]*(\d+)/)?.[1];
  return parsed ? Number(parsed) : undefined;
}

// Some orders store requirements in the nested `criteria` blob rather than as
// top-level columns (e.g. { criteria: { walkMinutes: 15 } }). Reading only the
// top level silently dropped those requirements before they ever reached the
// scorer, so the buyer's stated limit was never applied. Check both.
function buildOrderCriteria(order: Doc<"orders"> | null | undefined) {
  if (!order) return undefined;
  const nested = (order.criteria ?? {}) as Record<string, unknown>;
  const num = (name: string) =>
    (order[name as keyof typeof order] ?? nested[name]) as number | undefined;
  const strs = (name: string) =>
    (order[name as keyof typeof order] ?? nested[name]) as string[] | undefined;

  return {
    orderName: order.name as string | undefined,
    wards: strs("wards") ?? (order.ward ? [order.ward] : undefined),
    dealType: (order.dealType as "buy" | "rent" | undefined) ?? "buy",
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    rentMin: num("rentMin"),
    rentMax: num("rentMax"),
    maxDeposit: num("maxDeposit"),
    maxKeyMoney: num("maxKeyMoney"),
    petsRequired: (order.petsRequired ?? nested.petsRequired) as
      | boolean
      | undefined,
    // 専有面積 is stored as buildingSizeMin/Max; the scorer's field is areaMin/Max
    // (convex/lib/scoring.js). Without this fallback the buyer's stated unit-size
    // range never reached the score at all.
    areaMin: num("areaMin") ?? num("buildingSizeMin"),
    areaMax: num("areaMax") ?? num("buildingSizeMax"),
    landSizeMin: num("landSizeMin"),
    landSizeMax: num("landSizeMax"),
    minYield: num("minYield"),
    maxYield: num("maxYield"),
    walkMinutesMax: num("walkMinutesMax") ?? num("walkMinutes"),
    minRoadWidth: num("minRoadWidth"),
    propertyTypes: strs("propertyTypes"),
    structureTypes: strs("structureTypes"),
    maxBuildAge: num("maxBuildAge"),
    minBuildYear: num("minBuildYear"),
    ownerChange: (order.ownerChange ?? nested.ownerChange) as
      | boolean
      | undefined,
    excludeFirstFloor: (order.excludeFirstFloor ?? nested.excludeFirstFloor) as
      | boolean
      | undefined,
    maxFloor: num("maxFloor"),
    minElevators: num("minElevators"),
    minTotalUnits: num("minTotalUnits"),
  };
}

function EmailListingDetails({
  listing,
  handleOpenAttachment,
  openingAttachmentId,
}: {
  listing: any;
  handleOpenAttachment: (
    provider: string,
    messageId: string,
    attachment: { id?: string; filename: string; mimeType: string; size?: number },
  ) => Promise<void>;
  openingAttachmentId: string | null;
}) {
  const getEmailDetails = useAction(api.mailIngest.getEmailDetailsForListing);
  const [details, setDetails] = useState<{
    provider: string;
    messageId: string;
    subject: string;
    bodyText: string;
    attachments: Array<{ id?: string; filename: string; mimeType: string; size: number }>;
    from?: string;
    receivedAt?: number;
  } | null>(() => {
    if (listing?.emailSubject !== undefined && listing?.emailAttachments !== undefined) {
      const parts = (listing.url || "").split(":");
      return {
        provider: parts[1] || "gmail",
        messageId: parts[2] || "",
        subject: listing.emailSubject || "",
        bodyText: listing.emailBody || "",
        attachments: listing.emailAttachments || [],
        from: listing.emailFrom,
        receivedAt: listing.emailReceivedAt,
      };
    }
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    if (!details && listing?._id && (listing?.source === "email" || listing?.url?.startsWith("email:"))) {
      setLoading(true);
      getEmailDetails({ listingId: listing._id })
        .then((res) => {
          if (res) setDetails(res);
        })
        .catch((err) => {
          console.error("Failed to load email details for listing:", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [listing?._id, listing?.source, details, getEmailDetails]);

  const provider = details?.provider || (listing?.url || "").split(":")[1] || "gmail";
  const messageId = details?.messageId || (listing?.url || "").split(":")[2] || "";
  const subject = details?.subject ?? listing?.emailSubject;
  const from = details?.from ?? listing?.emailFrom;
  const receivedAt = details?.receivedAt ?? listing?.emailReceivedAt;
  const attachments = details?.attachments ?? listing?.emailAttachments ?? [];
  const bodyText = details?.bodyText ?? listing?.emailBody;

  return (
    <div className="rounded-xl border border-amber-200/90 bg-amber-50/40 p-3.5 space-y-3">
      {/* Top row: badge + sender + date */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 font-bold text-xs shadow-2xs">
            <Mail className="w-3.5 h-3.5 text-amber-700" />
            メール連携物件
          </span>
          {loading && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-800">
              <Loader2 className="w-3 h-3 animate-spin text-amber-600" />
              詳細読込中...
            </span>
          )}
        </div>
        {receivedAt && (
          <span className="text-[11px] font-medium text-amber-900/80">
            受信日時: {formatJaDateTime(receivedAt)}
          </span>
        )}
      </div>

      {/* From and Subject */}
      <div className="space-y-1.5 text-xs bg-white/70 rounded-lg p-2.5 border border-amber-100">
        {from && (
          <div className="flex items-start gap-2">
            <span className="font-bold text-amber-900 shrink-0">送信元:</span>
            <span className="text-slate-800 font-medium break-all">{from}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <span className="font-bold text-amber-900 shrink-0">件名:</span>
          <span className="text-slate-900 font-bold break-all">
            {subject || (loading ? "読込中..." : "(件名なし)")}
          </span>
        </div>
      </div>

      {/* Attachments Section */}
      {attachments.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold text-amber-900 flex items-center gap-1">
            <Paperclip className="w-3.5 h-3.5 text-amber-700" />
            添付ファイル ({attachments.length}件)
            <span className="text-[10px] font-normal text-amber-800/70 ml-1">
              — クリックすると別タブでプレビューが開きます
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a: any, i: number) => {
              const isPdf =
                a.mimeType === "application/pdf" ||
                a.filename?.toLowerCase().endsWith(".pdf");
              const isOpening = openingAttachmentId === a.id;
              return (
                <button
                  key={a.id || i}
                  type="button"
                  disabled={isOpening || !a.id}
                  onClick={() =>
                    void handleOpenAttachment(provider, messageId, a)
                  }
                  className="group flex items-center gap-2 px-3 py-1.5 rounded-xl border border-amber-200 bg-white hover:border-amber-400 hover:bg-amber-50/70 transition-all text-left shadow-2xs cursor-pointer"
                  title={a.id ? "クリックして別タブで開く" : "添付ファイルIDがありません"}
                >
                  {isOpening ? (
                    <Loader2 className="w-4 h-4 animate-spin text-amber-600 shrink-0" />
                  ) : isPdf ? (
                    <div className="flex items-center justify-center px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-black text-[10px] shrink-0 border border-rose-200">
                      PDF
                    </div>
                  ) : (
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                  )}
                  <div className="min-w-0 max-w-[220px]">
                    <span className="block font-bold text-[11px] text-slate-800 group-hover:text-amber-900 truncate">
                      {a.filename || "(添付ファイル)"}
                    </span>
                    <span className="block text-[10px] text-slate-500">
                      {a.size ? `${Math.round(a.size / 1024)}KB` : isPdf ? "PDF文書" : a.mimeType}
                    </span>
                  </div>
                  <ExternalLink className="w-3.5 h-3.5 text-amber-700 opacity-60 group-hover:opacity-100 shrink-0 ml-1" />
                </button>
              );
            })}
          </div>
        </div>
      ) : !loading ? (
        <div className="text-[11px] text-amber-800/70">
          ※ 添付ファイルはありません
        </div>
      ) : null}

      {/* Body Toggle */}
      {bodyText && (
        <div>
          <button
            type="button"
            onClick={() => setShowBody((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-900 hover:text-amber-950 hover:underline cursor-pointer"
          >
            {showBody ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                メール本文を閉じる
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                メール本文を表示
              </>
            )}
          </button>
          {showBody && (
            <pre className="mt-2 text-[11px] leading-relaxed whitespace-pre-wrap break-all bg-white/90 border border-amber-200/80 rounded-xl p-3 max-h-60 overflow-y-auto text-slate-700 font-sans shadow-inner">
              {bodyText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function OrdersPage() {
  const navigate = useNavigate();
  // Clerk's Convex JWT template does not map the `name` claim by default, so the
  // SERVER sees only a subject and can only label a search "ログインユーザー". The
  // browser knows the real name, so it is sent along for display only — see
  // triggeredByName in convex/scrapeTrigger.js. DashboardNav already calls
  // useUser() unconditionally, so this adds no new provider requirement.
  const { user } = useUser();
  const triggeredByName =
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    undefined;
  const orders = useQuery(api.orders.list);
  const customers = useQuery(api.customers.list);
  const createOrder = useMutation(api.orders.create);
  const deleteOrder = useMutation(api.orders.remove);
  const saveScore = useMutation(api.matching.saveScore);
  const updateOrder = useMutation(api.orders.update);
  const matches = useQuery(api.matching.list);
  // Only the ids: the star state for a 500-row list needs nothing else, and the
  // full snapshots belong to the 保存物件 page.
  const savedListingIds = useQuery(api.savedListings.savedListingIds);
  const toggleSaved = useMutation(api.savedListings.toggle);
  const savedSet = useMemo(
    () => new Set((savedListingIds ?? []).filter(Boolean) as string[]),
    [savedListingIds],
  );

  const matchListingIds = useMemo(() => {
    if (!matches) return [];
    return Array.from(
      new Set(
        matches
          .map((m) => m.listingId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }, [matches]);

  const fetchedListings = useQuery(
    api.listings.getByIds,
    matchListingIds.length > 0 ? { ids: matchListingIds } : "skip",
  );

  const listings = useMemo(() => {
    if (!matches) return undefined;
    if (matchListingIds.length === 0) return [];
    return fetchedListings;
  }, [matches, matchListingIds.length, fetchedListings]);
  const evaluateListing = useAction(api.evaluate.evaluateListing);
  const evaluateBatch = useAction(api.evaluate.evaluateBatch);
  // Read-only mailbox connection (convex/mailIngest.js) — a DIFFERENT feature
  // from the removed proposal-SEND integration: this reads broker emails and
  // matches them against orders, it never sends anything.
  const mailProviders = useQuery(api.mailIngestData.availableProviders);
  const mailAccounts = useQuery(api.mailIngestData.myAccounts);
  const startMailOAuth = useAction(api.mailIngest.startOAuth);
  const disconnectMailAccount = useMutation(api.mailIngestData.disconnect);
  const syncMailNow = useAction(api.mailIngest.syncNow);
  const [connectingMailProvider, setConnectingMailProvider] = useState<
    string | null
  >(null);
  const [syncingMail, setSyncingMail] = useState(false);
  const [mailNotice, setMailNotice] = useState<string | null>(null);

  // TEMPORARY: inspector for what the mail sync actually saw. A sync only
  // reports counts, so "物件情報は見つかりませんでした" cannot be told apart from a
  const inspectRecentMail = useAction(api.mailIngest.inspectRecentMail);
  const getAttachmentData = useAction(api.mailIngest.getAttachmentData);
  const [openingAttachmentId, setOpeningAttachmentId] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspected, setInspected] = useState<InspectedMail[] | null>(null);
  const [openMailId, setOpenMailId] = useState<string | null>(null);
  const [filterMatchedOnly, setFilterMatchedOnly] = useState(true);

  const handleOpenAttachment = async (
    provider: string,
    messageId: string,
    attachment: { id?: string; filename: string; mimeType: string },
  ) => {
    if (!attachment.id) {
      setMailNotice("添付ファイルIDが見つかりませんでした");
      return;
    }

    // Pre-open a blank tab in the user-initiated click context to bypass popup blockers
    const newWindow = window.open("about:blank", "_blank");
    if (newWindow) {
      newWindow.document.title = attachment.filename || "PDF読込中...";
    }

    setOpeningAttachmentId(attachment.id);
    try {
      const res = await getAttachmentData({
        provider,
        messageId,
        attachmentId: attachment.id,
        mimeType: attachment.mimeType,
        filename: attachment.filename,
      });

      if (res?.base64) {
        const byteCharacters = atob(res.base64);
        const byteNumbers = new Uint8Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const blob = new Blob([byteNumbers], { type: res.mimeType || "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        if (newWindow && !newWindow.closed) {
          newWindow.location.href = blobUrl;
        } else {
          window.open(blobUrl, "_blank");
        }
      } else {
        newWindow?.close();
        setMailNotice("PDFデータの取得に失敗しました");
      }
    } catch (err) {
      newWindow?.close();
      setMailNotice(
        `PDFの表示に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setOpeningAttachmentId(null);
    }
  };

  // Which incoming mail the sync bothers reading. Each rule list is edited as
  // one word/address per line — brokers are added and removed often enough
  // that a tag editor would be more ceremony than the job needs.
  const ingestSettings = useQuery(api.mailIngestData.getIngestSettings);
  const saveIngestSettings = useMutation(api.mailIngestData.saveIngestSettings);
  const [showMailRules, setShowMailRules] = useState(false);
  const [savingMailRules, setSavingMailRules] = useState(false);
  const [mailRules, setMailRules] = useState({
    requiredKeywords: "",
    blockedKeywords: "",
    allowedSenders: "",
    blockedSenders: "",
    requireAttachment: false,
  });

  // Seeded from the server row, and re-seeded each time the modal opens so a
  // cancelled edit does not linger as the next session's starting point.
  useEffect(() => {
    if (!showMailRules) return;
    setMailRules({
      requiredKeywords: (ingestSettings?.requiredKeywords ?? []).join("\n"),
      blockedKeywords: (ingestSettings?.blockedKeywords ?? []).join("\n"),
      allowedSenders: (ingestSettings?.allowedSenders ?? []).join("\n"),
      blockedSenders: (ingestSettings?.blockedSenders ?? []).join("\n"),
      requireAttachment: ingestSettings?.requireAttachment ?? false,
    });
  }, [showMailRules, ingestSettings]);

  const handleSaveMailRules = async () => {
    setSavingMailRules(true);
    try {
      const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);
      await saveIngestSettings({
        requiredKeywords: lines(mailRules.requiredKeywords),
        blockedKeywords: lines(mailRules.blockedKeywords),
        allowedSenders: lines(mailRules.allowedSenders),
        blockedSenders: lines(mailRules.blockedSenders),
        requireAttachment: mailRules.requireAttachment,
      });
      setShowMailRules(false);
      setMailNotice("取り込み設定を保存しました");
    } catch (err) {
      setMailNotice(
        `設定の保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSavingMailRules(false);
    }
  };

  const handleConnectMail = async (provider: string) => {
    setConnectingMailProvider(provider);
    setMailNotice(null);
    try {
      const { url } = await startMailOAuth({
        provider,
        redirectTo: window.location.href,
      });
      const popup = window.open(url, "zephind-mail-oauth", "width=520,height=680");
      if (!popup) window.location.assign(url);
    } catch (err) {
      setMailNotice(
        `メールアカウントの接続を開始できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setConnectingMailProvider(null);
    }
  };

  // The OAuth popup posts back here on completion (see convex/http.js
  // resultPage) — Convex's own reactivity then refreshes mailAccounts.
  useEffect(() => {
    const fallback = (ok: boolean) => (ok ? "メールアカウントを接続しました。" : "接続に失敗しました。");
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "zephind-oauth") {
        setMailNotice(e.data.message || fallback(e.data.ok));
      }
    };
    window.addEventListener("message", onMessage);

    // Popup blocked: the OAuth flow ran in this tab and landed back with the result.
    const params = new URLSearchParams(window.location.search);
    if (params.has("mailOAuth") && !window.opener) {
      setMailNotice(params.get("mailOAuthMsg") || fallback(params.get("mailOAuth") === "ok"));
      params.delete("mailOAuth");
      params.delete("mailOAuthMsg");
      const query = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
    }
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const handleInspectMail = async (runAi = false) => {
    setInspecting(true);
    try {
      const rows = (await inspectRecentMail({
        limit: 100,
        daysBack: 90,
        matchingOnly: true,
        // Runs the same extraction a sync performs — one model call per message
        // the rules could not read — so it is a deliberate click, not automatic.
        runAi,
      })) as InspectedMail[];
      setInspected(rows);
      const firstValid = rows.find((r) => !r.filtered && !r.error);
      setOpenMailId(firstValid?.id ?? rows[0]?.id ?? null);
    } catch (err) {
      setMailNotice(
        `メールの確認に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setInspecting(false);
    }
  };

  const handleSyncMailNow = async () => {
    setSyncingMail(true);
    setMailNotice(null);
    try {
      const results = await syncMailNow({ fullSync: true, daysBack: 90 });
      // "0 listings found" and "every message failed extraction" (e.g. Rax AI
      // down) used to look identical — surface message counts and any real
      // errors so a stuck sync is diagnosable instead of looking like "no new
      // mail" every time.
      const lines = results.map((r) => {
        if (r.error === "REAUTH_REQUIRED") {
          return `${r.provider}: 認証切れです。再接続してください。`;
        }
        const parts = [`${r.provider}: メール${r.synced ?? 0}件を確認`];
        if ((r.listingsFound ?? 0) > 0) {
          parts.push(`${r.listingsFound}件の物件情報を抽出`);
        }
        if ((r.filteredOut ?? 0) > 0) {
          parts.push(`${r.filteredOut}件を設定により除外`);
        }
        if ((r.messageErrors?.length ?? 0) > 0) {
          parts.push(`${r.messageErrors.length}件でエラー: ${r.messageErrors[0]}`);
        }
        if (
          (r.synced ?? 0) > 0 &&
          (r.listingsFound ?? 0) === 0 &&
          (r.filteredOut ?? 0) === 0 &&
          (r.messageErrors?.length ?? 0) === 0
        ) {
          parts.push("物件情報は見つかりませんでした");
        }
        return parts.join(" / ");
      });
      setMailNotice(lines.join("\n"));
    } catch (err) {
      setMailNotice(
        `同期に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSyncingMail(false);
    }
  };

  // Scraping no longer happens in the browser — see convex/scrapeTrigger.js.
  const triggerScrape = useAction(api.scrapeTrigger.triggerScrape);
  const getRecentRuns = useAction(api.scrapeTrigger.getRecentRuns);
  const cancelScrape = useAction(api.scrapeTrigger.cancelScrape);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(
    null,
  );

  // Scrape progress used to live in local React state, so a reload lost it and a
  // 20-minute GitHub run looked like nothing was happening. GitHub is the only
  // real source of truth here (the browser is not involved in the run at all),
  // so poll it. Actions cannot be useQuery, hence the manual interval.
  // GitHub workflow runs are GLOBAL: getRecentRuns returns any run by anyone, so
  // showing the banner on `activeRun` alone told account A that account B was
  // scraping. `orders` is per-user scoped, so requiring one of MY orders to be
  // mid-dispatch keeps the indicator to runs this account actually asked for.
  /** True only when the live GitHub run is one THIS account started. */
  const isMyRun = (o: { scrapeRunId?: number }) =>
    activeRun != null &&
    o.scrapeRunId != null &&
    o.scrapeRunId === activeRun.id;

  const ordersRef = useRef<typeof orders>(undefined);
  ordersRef.current = orders;
  const [activeRun, setActiveRun] = useState<{
    id: number;
    status: string;
    html_url: string;
    created_at: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = (await getRecentRuns({})) as
          | { runs?: any[]; error?: string }
          | undefined;
        if (cancelled || !r?.runs) return;
        // queued | in_progress mean a run is live; anything else is finished.
        const live = r.runs.find(
          (x) => x.status === "queued" || x.status === "in_progress",
        );
        setActiveRun(live ?? null);
        // Run finished: clear any order still flagged as dispatched, otherwise
        // the badge sticks permanently (nothing else ever tells the app it ended).
        if (!live) {
          for (const o of ordersRef.current ?? []) {
            if (o.scrapingStatus === "dispatched") {
              void updateOrder({
                id: o._id,
                scrapingStatus: "completed",
              }).catch(() => {});
            }
          }
        }
      } catch {
        /* transient GitHub/network hiccups shouldn't clear a known-live run */
      }
    };
    void poll();
    const id = setInterval(poll, 30_000); // 30s: runs last minutes, not seconds
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [getRecentRuns]);

  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  // Whole-card accordion: hides the matched-listings section behind a bottom
  // toggle bar, keeping just the header (title/criteria/actions) visible.
  // Closed by default — a card with a name in the set is the expanded one.
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const toggleOrderExpanded = (orderId: string) =>
    setExpandedOrders((prev) => {
      const next = new Set(prev);
      next.has(orderId) ? next.delete(orderId) : next.add(orderId);
      return next;
    });

  // Order search, status filter & sorting state
  const [orderSearchQuery, setOrderSearchQuery] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<
    "all" | "scraping" | "newMatches" | "hasMatches" | "pending" | "completed"
  >("all");
  const [orderSortKey, setOrderSortKey] = useState<
    "newest" | "matchesDesc" | "newMatchesDesc" | "nameAsc"
  >("newest");
  // Properties ticked in the results list, carried into the proposal modal so
  // the same list is not presented twice.
  const [selectedForProposal, setSelectedForProposal] = useState<Set<string>>(
    new Set(),
  );
  const toggleProposalSelection = (matchId: string) =>
    setSelectedForProposal((prev) => {
      const next = new Set(prev);
      next.has(matchId) ? next.delete(matchId) : next.add(matchId);
      return next;
    });
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<Record<string, string>>({});
  const [scoreDetails, setScoreDetails] = useState<
    Record<string, EvaluationScoreDetail>
  >({});
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);

  const [scrapingOrderId, setScrapingOrderId] = useState<string | null>(null);
  const [evaluatingOrderId, setEvaluatingOrderId] = useState<string | null>(
    null,
  );
  /**
   * GitHub Actions (committed code, works from any device) vs this machine
   * (working tree, needs the dev server). Remembered per browser: whoever is
   * developing scrapers wants local every time, and everyone else never does.
   */
  const [runner, setRunner] = useState<ScrapeRunner>(() => {
    const stored = localStorage.getItem("zephind_scrape_runner");
    // A stored "local" preference must not leak onto a deployed origin.
    return stored === "local" && IS_LOCALHOST ? "local" : "github";
  });
  const chooseRunner = (next: ScrapeRunner) => {
    if (next === "local" && !IS_LOCALHOST) return;
    setRunner(next);
    localStorage.setItem("zephind_scrape_runner", next);
  };
  /** Order whose local run we are waiting on, so its flag can be cleared. */
  const [localRunOrderId, setLocalRunOrderId] = useState<string | null>(null);
  /**
   * Orders whose local run was killed by an explicit cancel click, not a crash.
   *
   * The kill (SIGTERM, escalating to SIGKILL — see handleCancelScrape) makes the
   * child process exit via a signal, not `exit(0)`, so the status poll below
   * cannot otherwise tell "the user stopped this on purpose" apart from "it
   * crashed" — both just look like a non-zero exit code from the outside.
   */
  const canceledLocalRunsRef = useRef<Set<string>>(new Set());

  const [scrapeSource, setScrapeSource] = useState<Record<string, string>>({});
  const [activeScrapeSites, setActiveScrapeSites] = useState<
    Record<string, string>
  >({});

  const getOrderSiteLabel = (order: Doc<"orders">) => {
    if (
      order.scrapingStatus &&
      order.scrapingStatus !== "completed" &&
      order.scrapingStatus !== "failed" &&
      order.scrapingStatus !== "cancelled" &&
      order.scrapingStatus !== "dispatched"
    ) {
      return order.scrapingStatus;
    }
    if (order.activeSource && order.activeSource !== "all") {
      const src = order.activeSource;
      const label = SOURCE_LABELS[src] || src;
      return `${label} を検索中...`;
    }
    if (activeScrapeSites[order._id]) {
      const s = activeScrapeSites[order._id];
      return s.includes("検索中") ? s : `${s} を検索中...`;
    }
    return "ポータルを順に検索中...";
  };

  const [showLimit, setShowLimit] = useState<Record<string, number>>({});
  const [currentPage, setCurrentPage] = useState<Record<string, number>>({});
  // Per-order sort of the extracted listings. Newest-first is the default.
  const [sortKey, setSortKey] = useState<Record<string, SortKey>>({});
  /** Per-order quick filter; absent means すべて. */
  const [listFilter, setListFilter] = useState<Record<string, string>>({});
  const [evalProgress, setEvalProgress] = useState<
    Record<string, { current: number; total: number }>
  >({});
  const [orderStatus, setOrderStatus] = useState<string>("pending");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [proposalOrder, setProposalOrder] = useState<Doc<"orders"> | null>(
    null,
  );

  // Per-order banner explaining that a dispatch was accepted (or why it wasn't).
  // The run itself happens on GitHub Actions, so there is nothing here to poll;
  // rows arrive through the reactive `matches`/`listings` queries.
  const [scrapeNotice, setScrapeNotice] = useState<
    Record<string, { kind: "ok" | "error"; text: string }>
  >({});

  const toggleExpand = (id: string) => {
    setExpandedMatch(expandedMatch === id ? null : id);
  };

  const handleEvaluate = async (
    matchId: string,
    listing: Doc<"listings">,
    order?: Doc<"orders">,
  ) => {
    setEvaluatingId(matchId);
    setExpandedMatch(matchId);

    // Clear old local evaluation so UI shows fresh state immediately
    setEvaluations((prev) => {
      const copy = { ...prev };
      delete copy[matchId];
      return copy;
    });

    try {
      const orderCriteria = buildOrderCriteria(order);

      const result = await evaluateListing({
        matchId: matchId,
        address: listing.address,
        ward: listing.ward,
        price: listing.price,
        landSize: listing.landSize,
        area: listing.area,
        buildingCoverageRatio: listing.buildingCoverageRatio,
        floorAreaRatio: listing.floorAreaRatio,
        walkMinutes: listing.walkMinutes,
        station: listing.station,
        buildYear: listing.buildYear,
        roadWidth: listing.roadWidth,
        frontage: listing.frontage,
        rooms: listing.rooms,
        layout: listing.layout,
        propertyType: listing.propertyType,
        description: listing.description,
        yield: listing.yield || listing.grossYield || listing.netYield,
        structure: listing.structure || listing.buildingStructure,
        floor: listing.floor,
        totalUnits: listing.totalUnits,
        elevators: listing.elevators,
        previousPrice: listing.previousPrice,
        initialPrice: listing.initialPrice,
        priceDropPct: listing.priceDropPct,
        priceDropped: listing.priceDropped,
        dealType: listing.dealType,
        rent: listing.rent,
        managementFee: listing.managementFee,
        deposit: listing.deposit,
        keyMoney: listing.keyMoney,
        petsAllowed: listing.petsAllowed,
        orderCriteria,
      });
      setEvaluations((prev) => ({
        ...prev,
        [matchId]: result.evaluation || result.error || "評価エラー",
      }));
      if (result.scoreDetail) {
        setScoreDetails((prev) => ({
          ...prev,
          [matchId]: result.scoreDetail as EvaluationScoreDetail,
        }));
      }
    } catch (err) {
      setEvaluations((prev) => ({
        ...prev,
        [matchId]: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleDelete = async (id: Id<"orders">) => {
    try {
      await deleteOrder({ id });
    } catch (err) {
      // Without this, a failed delete (e.g. ownership check) looked
      // identical to a successful one — the card just silently stayed put.
      setScrapeNotice((prev) => ({
        ...prev,
        [id]: {
          kind: "error",
          text: `削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
        },
      }));
    }
  };

  // Auto-evaluate after a scrape.
  //
  // This cannot be done by awaiting the scrape and calling handleBatchEvaluate
  // directly (the old code did that after a 600ms sleep): handleBatchEvaluate
  // reads `matches` from useQuery, so it closes over the value from the render
  // it was created in. The freshly-created matches are not in that snapshot no
  // matter how long you sleep, so it evaluated nothing. Instead, flag the order
  // and let an effect fire once the reactive query actually contains its matches.
  // Always on: evaluating after a scrape is the point, and a checkbox nobody
  // unticks is just noise. NOTE it still only runs while the tab is open — the
  // effect reacts to matches arriving in the browser. Hence the manual fallback.
  const autoEvaluate = true;
  const [pendingAutoEvalOrderId, setPendingAutoEvalOrderId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!pendingAutoEvalOrderId || !matches || !listings || !orders) return;
    if (scrapingOrderId === pendingAutoEvalOrderId) return; // scrape still running
    if (evaluatingOrderId) return; // another batch already in flight — this
    // effect re-runs the moment it clears, so a newly-arrived listing is not lost

    const orderId = pendingAutoEvalOrderId;
    const pending = matches.filter((m) => {
      if (m.orderId !== orderId) return false;
      const listing = listings.find((l) => l._id === m.listingId);
      return listing && !m.evaluation && !evaluations[m._id];
    });
    if (pending.length === 0) return; // nothing new to evaluate right now

    // Deliberately NOT `setPendingAutoEvalOrderId(null)` here, and no
    // "fired once" dedup either — a local (or GitHub) sweep across many
    // sources keeps ingesting new matches for MINUTES after the first batch
    // shows up. Consuming the flag on the first partial batch used to mean
    // everything scraped after that point — often most of a large multi-source
    // sweep — silently never got auto-evaluated, no error, just quietly
    // "未評価" forever until someone noticed and clicked 評価 by hand. Leaving
    // the flag armed costs nothing: once nothing is pending, this is a no-op.
    const order = orders.find((o) => o._id === orderId);
    if (order) void handleBatchEvaluate(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    pendingAutoEvalOrderId,
    matches,
    listings,
    orders,
    scrapingOrderId,
    evaluatingOrderId,
  ]);

  const handleBatchEvaluate = async (order: Doc<"orders">, force = false) => {
    setEvaluatingOrderId(order._id);
    const orderMatchList =
      matches?.filter((m) => m.orderId === order._id) ?? [];

    if (orderMatchList.length > 0 && !expandedMatch) {
      setExpandedMatch(orderMatchList[0]._id);
    }

    const unevaluatedMatches = orderMatchList.filter((m) => {
      const listing = listings?.find((l) => l._id === m.listingId);
      return listing && (force || (!evaluations[m._id] && !m.evaluation));
    });

    setEvalProgress((prev) => ({
      ...prev,
      [order._id]: { current: 0, total: unevaluatedMatches.length },
    }));

    const orderCriteria = buildOrderCriteria(order);

    const BATCH_SIZE = 5;
    try {
      for (let i = 0; i < unevaluatedMatches.length; i += BATCH_SIZE) {
        const chunk = unevaluatedMatches.slice(i, i + BATCH_SIZE);
        // One request per chunk: the server makes a single LLM call for all of
        // them, which is what keeps us under Rax's ~15 calls/minute.
        const items = chunk.flatMap((m) => {
          const listing = listings?.find((l) => l._id === m.listingId);
          if (!listing) return [];
          return [{
            matchId: m._id,
            address: listing.address,
            ward: listing.ward,
            price: listing.price,
            landSize: listing.landSize,
            area: listing.area,
            buildingCoverageRatio: listing.buildingCoverageRatio,
            floorAreaRatio: listing.floorAreaRatio,
            walkMinutes: listing.walkMinutes,
            station: listing.station,
            buildYear: listing.buildYear,
            roadWidth: listing.roadWidth,
            frontage: listing.frontage,
            rooms: listing.rooms,
            layout: listing.layout,
            propertyType: listing.propertyType,
            description: listing.description,
            yield: listing.yield || listing.grossYield || listing.netYield,
            structure: listing.structure || listing.buildingStructure,
            floor: listing.floor,
            totalUnits: listing.totalUnits,
            elevators: listing.elevators,
            previousPrice: listing.previousPrice,
            initialPrice: listing.initialPrice,
            priceDropPct: listing.priceDropPct,
            priceDropped: listing.priceDropped,
            dealType: listing.dealType,
            rent: listing.rent,
            managementFee: listing.managementFee,
            deposit: listing.deposit,
            keyMoney: listing.keyMoney,
            petsAllowed: listing.petsAllowed,
            orderCriteria,
          }];
        });
        try {
          const { results = [], error } = (await evaluateBatch({ items })) ?? {};
          if (error) console.error("Batch evaluation error", error);
          for (const result of results) {
            if (!result?.matchId) continue;
            if (result.evaluation) {
              setEvaluations((prev) => ({
                ...prev,
                [result.matchId]: result.evaluation,
              }));
            }
            if (result.scoreDetail) {
              setScoreDetails((prev) => ({
                ...prev,
                [result.matchId]: result.scoreDetail as EvaluationScoreDetail,
              }));
            }
          }
        } catch (err) {
          console.error("Evaluation error for batch", items.map((x) => x.matchId), err);
        }

        setEvalProgress((prev) => ({
          ...prev,
          [order._id]: {
            current: Math.min(i + BATCH_SIZE, unevaluatedMatches.length),
            total: unevaluatedMatches.length,
          },
        }));
      }
    } finally {
      setEvaluatingOrderId(null);
    }
  };

  /**
   * Ward labels on the order -> JIS area codes for the workflow's `areas` input.
   * An order that names no ward sweeps all 23 wards, exactly as the old
   * browser-side scrape did.
   */
  const areaCodesForOrder = (order: Doc<"orders">) => {
    const orderWards =
      order.wards && order.wards.length > 0
        ? order.wards
        : order.ward
          ? [order.ward]
          : [];
    if (orderWards.length === 0) return ALL_TOKYO_WARD_CODES;
    return orderWards
      .map((w: string) => wardLabelToCode(w))
      .filter(Boolean) as string[];
  };

  /**
   * Ask GitHub Actions to run the scrape.
   *
   * WAS: `fetch(VITE_SCRAPER_URL + "/scrape")` from the browser, then write every
   * returned listing to Convex from right here. VITE_SCRAPER_URL is frozen into
   * the bundle at build time as http://localhost:3001, so on any machine other
   * than the developer's the fetch pointed at a scraper that does not exist —
   * these buttons were dead on every phone and every other laptop.
   *
   * NOW: convex/scrapeTrigger.js dispatches .github/workflows/scrape.yml, and the
   * GitHub runner both scrapes and persists (scraper-service/src/cli.ts ->
   * convex/ingest.js). So this returns the moment GitHub ACCEPTS the request;
   * listings and matches land minutes later via the reactive useQuery calls.
   * Nothing in this browser is ever told the run finished, so nothing here
   * claims it did, and no spinner is left running waiting for word.
   */
  const dispatchScrape = async (order: Doc<"orders">, sources: string[]) => {
    setScrapingOrderId(order._id);
    const siteLabel =
      sources.length > 1
        ? "すべてのサイト (全19サイト)"
        : SOURCE_LABELS[sources[0]] || sources[0];
    setActiveScrapeSites((prev) => ({ ...prev, [order._id]: siteLabel }));

    setScrapeNotice((prev) => {
      const next = { ...prev };
      delete next[order._id];
      return next;
    });

    const fail = async (text: string) => {
      setScrapeNotice((prev) => ({
        ...prev,
        [order._id]: { kind: "error", text },
      }));
      // Never leave the card claiming to be busy because a dispatch failed.
      await updateOrder({
        id: order._id,
        isScraping: false,
        scrapingStatus: "failed",
      });
    };

    try {
      const result = (await triggerScrape({
        areas: areaCodesForOrder(order).join(","),
        sources: sources.join(","),
        triggeredByName,
        // Lets the action stamp this order with the run it started, so progress
        // is attributed to this order (and therefore this account) precisely.
        orderId: order._id,
      })) as { ok?: boolean; runId?: number; error?: string } | undefined;

      if (!result || result.error) {
        await fail(
          result?.error ?? "検索を開始できませんでした（応答がありません）",
        );
        return;
      }

      setScrapeNotice((prev) => ({
        ...prev,
        [order._id]: {
          kind: "ok",
          text: `「${siteLabel}」からの検索リクエストを送信しました。完了まで数分かかります。`,
        },
      }));
      // "dispatched", not "scraping". The run lives on GitHub; a "scraping" flag
      // written here would be a spinner with nothing left to clear it.
      await updateOrder({
        id: order._id,
        isScraping: true,
        scrapingStatus: `${siteLabel} を検索中...`,
        activeSource: sources.length === 1 ? sources[0] : "all",
      });

      // The effect above deliberately waits for this order's matches to show up
      // in the reactive query before evaluating, which is what an asynchronous
      // run needs — but it only fires while this tab stays open.
      if (autoEvaluate) setPendingAutoEvalOrderId(order._id);
    } catch (err: unknown) {
      console.error("Scrape dispatch error:", err);
      await fail(
        `検索を開始できませんでした: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setScrapingOrderId(null);
    }
  };

  // A local run has no GitHub run to poll, so the GitHub poller above will never
  // clear its badge. Watch the local service instead and clear on completion,
  // reporting a non-zero exit rather than just going quiet.
  useEffect(() => {
    if (!localRunOrderId) return;
    let cancelled = false;
    const orderId = localRunOrderId as Id<"orders">;

    const poll = async () => {
      try {
        const res = await fetch(`${LOCAL_SCRAPER_URL}/scrape-run/status`);
        if (!res.ok) return;
        const status = (await res.json()) as {
          running?: boolean;
          exitCode?: number | null;
          lines?: string[];
        };
        if (cancelled) return;
        if (status.running) {
          const rawLast = (status.lines ?? []).slice(-1)[0];
          if (rawLast) {
            const clean = rawLast.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "").trim();
            const display = clean.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*/, "");
            setScrapeNotice((prev) => ({
              ...prev,
              [orderId]: {
                kind: "ok",
                text: `ローカル検索を実行中...\n${display}`,
              },
            }));
          }
          return;
        }

        // A kill from an explicit cancel click also exits non-zero — that is
        // not a crash, and handleCancelScrape already posted its own message,
        // so leave both alone here rather than overwriting them with "異常終了".
        const wasCanceled = canceledLocalRunsRef.current.delete(orderId);
        if (wasCanceled) {
          setLocalRunOrderId(null);
          return;
        }

        await updateOrder({
          id: orderId,
          isScraping: false,
          scrapingStatus: status.exitCode === 0 ? "completed" : "failed",
        });
        setScrapeNotice((prev) => ({
          ...prev,
          [orderId]: {
            kind: status.exitCode === 0 ? "ok" : "error",
            text:
              status.exitCode === 0
                ? "ローカル検索が完了しました。取得した物件は一覧に反映されています。"
                : `ローカル検索が異常終了しました (exit ${status.exitCode})。` +
                  `最後の出力: ${(status.lines ?? []).slice(-2).join(" / ") || "(なし)"}`,
          },
        }));
        setLocalRunOrderId(null);
      } catch {
        /* dev server stopped mid-run — leave the badge for the next tick */
      }
    };

    void poll();
    const id = setInterval(poll, 4_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localRunOrderId]);

  /**
   * Reconcile any OTHER order's stuck "検索中" badge — the poll above only
   * ever tracks ONE order (`localRunOrderId`), so starting a second local run
   * for a different order (or reloading the page) abandons tracking of
   * whichever order was being watched before, and its badge is then stuck
   * showing its last real progress line forever (confirmed live: two
   * different orders' cards both frozen on the exact same "[19/19] 朝日住宅"
   * text — each was simply the last update it received before its own
   * tracking got abandoned, well after the underlying run had actually
   * finished).
   *
   * The local scraper server enforces ONE run at a time (a second dispatch is
   * refused with 409 until the first ends), so if the server's own status now
   * points at a DIFFERENT order (or none), THIS order's local run is
   * guaranteed to have already ended one way or another — safe to resolve
   * even though this browser never saw it happen.
   */
  useEffect(() => {
    if (!orders) return;
    const stuckOrders = orders.filter(
      (o) =>
        o._id !== localRunOrderId &&
        (o.lastScrapeBy ?? "").includes("ローカル実行") &&
        (o.isScraping ||
          (o.scrapingStatus && o.scrapingStatus.includes("検索中"))),
    );
    if (stuckOrders.length === 0) return;
    let cancelled = false;

    const reconcile = async () => {
      try {
        const res = await fetch(`${LOCAL_SCRAPER_URL}/scrape-run/status`);
        if (!res.ok || cancelled) return;
        const status = (await res.json()) as {
          running?: boolean;
          orderId?: string | null;
        };
        for (const order of stuckOrders) {
          if (status.orderId === order._id && status.running) continue; // genuinely still running
          await updateOrder({
            id: order._id,
            isScraping: false,
            scrapingStatus: "completed",
          });
        }
      } catch {
        // Dev server unreachable — cannot safely tell these apart from "still
        // running on a machine this tab can't reach", so leave them as-is.
      }
    };

    void reconcile();
    const id = setInterval(reconcile, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, localRunOrderId]);

  /**
   * Run the scrape on THIS machine (scraper-service) instead of dispatching
   * GitHub Actions.
   *
   * The cloud run executes the repo's COMMITTED code, so an uncommitted scraper
   * change cannot be tested through the UI at all. This posts to the local
   * service, which runs the same `npm run scrape:cron` entrypoint from the working
   * tree and writes to the same Convex deployment — so results appear here
   * identically, they are just produced by the code on disk.
   *
   * Requires `npm run dev:scraper` to be running. Its progress reaches the card
   * through the CLI's own updateProgress writes; when the run ends, the poll below
   * clears the flag (nothing else would).
   */
  const dispatchLocalScrape = async (
    order: Doc<"orders">,
    sources: string[],
  ) => {
    setScrapingOrderId(order._id);
    const siteLabel =
      sources.length > 1
        ? "すべてのサイト (全19サイト)"
        : SOURCE_LABELS[sources[0]] || sources[0];
    setActiveScrapeSites((prev) => ({ ...prev, [order._id]: siteLabel }));
    setScrapeNotice((prev) => {
      const next = { ...prev };
      delete next[order._id];
      return next;
    });

    try {
      const res = await fetch(`${LOCAL_SCRAPER_URL}/scrape-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          areas: areaCodesForOrder(order).join(","),
          sources: sources.join(","),
          orderId: order._id,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || body.error) {
        setScrapeNotice((prev) => ({
          ...prev,
          [order._id]: {
            kind: "error",
            text:
              body.error ??
              `ローカルスクレイパーがエラーを返しました (HTTP ${res.status})`,
          },
        }));
        return;
      }

      setScrapeNotice((prev) => ({
        ...prev,
        [order._id]: {
          kind: "ok",
          text: `ローカル（このPC）で「${siteLabel}」の検索を開始しました。ターミナルに進捗が表示されます。`,
        },
      }));
      await updateOrder({
        id: order._id,
        isScraping: false,
        scrapingStatus: `${siteLabel} を検索中... (ローカル)`,
        activeSource: sources.length === 1 ? sources[0] : "all",
        lastScrapeAt: Date.now(),
        // Attribution: the local run has no Convex identity to derive this from,
        // so the browser records who started it, as it does for the cloud path.
        lastScrapeBy: triggeredByName
          ? `${triggeredByName}（ローカル実行）`
          : "ローカル実行",
      });
      setLocalRunOrderId(order._id);
      if (autoEvaluate) setPendingAutoEvalOrderId(order._id);
    } catch (err) {
      // A refused connection is the common case: the dev server is not running.
      setScrapeNotice((prev) => ({
        ...prev,
        [order._id]: {
          kind: "error",
          text:
            `ローカルスクレイパーに接続できませんでした (${LOCAL_SCRAPER_URL})。` +
            `確認事項: ① 別ターミナルで \`npm run dev:scraper\` が起動しているか。` +
            `② ポート3001を他のアプリ（別プロジェクトの開発サーバー等）が使っていないか` +
            `（\`lsof -nP -iTCP:3001 -sTCP:LISTEN\` で確認できます）。` +
            `（${err instanceof Error ? err.message : String(err)}）`,
        },
      }));
    } finally {
      setScrapingOrderId(null);
    }
  };

  const handleScrapeOrder = (order: Doc<"orders">) => {
    // "all" is the default selection, so the single 取得 button covers both the
    // every-portal case and a single-portal case.
    const chosen = scrapeSource[order._id] || "all";
    const sources = chosen === "all" ? ALL_SCRAPE_SOURCES : [chosen];
    return runner === "local"
      ? dispatchLocalScrape(order, sources)
      : dispatchScrape(order, sources);
  };

  /**
   * Cancel whichever run is actually active for this order.
   *
   * A local run has no GitHub Actions run id at all, so calling cancelScrape()
   * (which cancels via `order.scrapeRunId` over the GitHub API) always finds
   * nothing to cancel and returns "このオーダーには実行中のスクレイピングが
   * ありません" — a confusing error for a run that IS visibly in progress, just
   * not the kind that action knows how to stop.
   *
   * `order.scrapingStatus` looks like the obvious way to detect a local run
   * (dispatchLocalScrape stamps it with a "(ローカル)" suffix) but is NOT
   * reliable: cli.ts's own per-source progress reporting (convex/ingest.js
   * `updateProgress`) overwrites that field every few seconds with a generic
   * "{source} を検索中..." string, on BOTH the local and GitHub-Actions paths —
   * erasing the marker within seconds of the run actually starting. Branch on
   * `order.lastScrapeBy` instead: it is set once at dispatch to "ローカル実行"
   * (or "{name}（ローカル実行）") and `updateProgress` never touches it, so it
   * stays correct for the whole run — and, being persisted rather than the
   * in-memory `localRunOrderId`, it survives a page reload too.
   */
  const handleCancelScrape = async (order: Doc<"orders">) => {
    const isLocalRun = (order.lastScrapeBy ?? "").includes("ローカル実行");
    setCancellingOrderId(order._id);
    try {
      if (isLocalRun) {
        // Mark BEFORE sending the kill, so the status poll (running every 10s
        // regardless of this click) sees it no matter which of the two fires
        // first — see the note where this set is declared.
        canceledLocalRunsRef.current.add(order._id);
        try {
          // The local server tracks exactly ONE run at a time, GLOBALLY, not
          // per order — /scrape-run/cancel kills whatever that is. If this
          // order's own badge is just stale (its run already finished or was
          // superseded by a newer dispatch for a DIFFERENT order — confirmed
          // live: an order's "検索中" can outlive its actual process once this
          // tab starts tracking a different one), sending the real kill would
          // cancel someone else's still-genuinely-running scrape instead.
          // Check ownership first.
          const statusRes = await fetch(`${LOCAL_SCRAPER_URL}/scrape-run/status`);
          const status = (await statusRes.json().catch(() => ({}))) as {
            running?: boolean;
            orderId?: string | null;
          };
          const ownsCurrentRun = status.running && status.orderId === order._id;

          let cancelOk = true;
          let alreadyFinished = true;
          if (ownsCurrentRun) {
            const res = await fetch(`${LOCAL_SCRAPER_URL}/scrape-run/cancel`, {
              method: "POST",
            });
            const body = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              alreadyFinished?: boolean;
            };
            cancelOk = res.ok && !!body.ok;
            alreadyFinished = !!body.alreadyFinished;
          }

          await updateOrder({
            id: order._id,
            isScraping: false,
            scrapingStatus: "cancelled",
          });
          setLocalRunOrderId((prev) => (prev === order._id ? null : prev));
          setScrapeNotice((prev) => ({
            ...prev,
            [order._id]: {
              kind: "ok",
              text: !ownsCurrentRun
                ? "この検索は既に終了していました（表示が古くなっていました）。表示を更新しました。"
                : cancelOk
                  ? alreadyFinished
                    ? "ローカル検索は既に終了していました。表示を更新しました。"
                    : "ローカル検索を中止しました。"
                  : "ローカルスクレイパーへの中止要求に失敗しました。表示のみ更新しました。",
            },
          }));
        } catch (err) {
          // Dev server unreachable — still clear the stuck badge, since
          // whatever was running is not something this browser can reach.
          await updateOrder({
            id: order._id,
            isScraping: false,
            scrapingStatus: "cancelled",
          });
          setScrapeNotice((prev) => ({
            ...prev,
            [order._id]: {
              kind: "error",
              text:
                `ローカルスクレイパーに接続できませんでした (${LOCAL_SCRAPER_URL})が、` +
                `表示上の「検索中」は解除しました。` +
                `（${err instanceof Error ? err.message : String(err)}）`,
            },
          }));
        }
        return;
      }

      const r = (await cancelScrape({ orderId: order._id })) as
        | { ok?: boolean; error?: string }
        | undefined;
      setScrapeNotice((prev) => ({
        ...prev,
        [order._id]: {
          kind: r?.error ? "error" : "ok",
          text: r?.error
            ? r.error
            : "物件検索を中止し、GitHub Actions の実行を停止しました。",
        },
      }));
    } finally {
      setCancellingOrderId(null);
    }
  };

  const [showForm, setShowForm] = useState(false);
  const [wards, setWards] = useState<string[]>([]);
  // 買う/借りる — mutually exclusive, never both. Everything below that only
  // makes sense for one side (価格 vs 賃料, 利回り, 敷金/礼金) is gated on this.
  const [dealType, setDealType] = useState<"buy" | "rent">("buy");
  const [priceMin, setPriceMin] = useState("");
  const [orderName, setOrderName] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [rentMin, setRentMin] = useState("");
  const [rentMax, setRentMax] = useState("");
  const [maxDeposit, setMaxDeposit] = useState("");
  const [maxKeyMoney, setMaxKeyMoney] = useState("");
  const [petsRequired, setPetsRequired] = useState(false);
  const [walkMinutes, setWalkMinutes] = useState("");
  const [minBuildingCoverageRatio, setMinBuildingCoverageRatio] = useState("");
  const [minFloorAreaRatio, setMinFloorAreaRatio] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
  // オーナーチェンジ = 賃貸中のマンションをそのまま売却する物件。物件の形ではなく
  // 売り方なので、種別ボタンではなく マンション の隣のチェックボックスにしている。
  const [ownerChange, setOwnerChange] = useState(false);
  const [landSizeMin, setLandSizeMin] = useState("");
  const [landSizeMax, setLandSizeMax] = useState("");
  const [buildingSizeMin, setBuildingSizeMin] = useState("");
  const [buildingSizeMax, setBuildingSizeMax] = useState("");
  const [maxBuildAge, setMaxBuildAge] = useState("");
  const [minBuildYear, setMinBuildYear] = useState("");
  const [minYield, setMinYield] = useState("");
  const [maxYield, setMaxYield] = useState("");
  const [minRoadWidth, setMinRoadWidth] = useState("");
  const [minTotalUnits, setMinTotalUnits] = useState("");
  const [maxFloor, setMaxFloor] = useState("");
  const [excludeFirstFloor, setExcludeFirstFloor] = useState(false);
  const [minElevators, setMinElevators] = useState("");
  const [structureTypes, setStructureTypes] = useState<string[]>([]);
  const [layoutTypes, setLayoutTypes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState(false);
  // A failed save used to go to console.error only, so pressing 作成 looked like
  // it did nothing at all — the mutation travels over Convex's WebSocket, so
  // there is not even a request in the Network tab to hint otherwise. Any
  // rejection has to be on screen.
  const [saveError, setSaveError] = useState<string | null>(null);

  // Which conditions are worth showing for the selected types. No selection means
  // "any type", so everything is shown rather than nothing.
  const anyTypeSelected = propertyTypes.length === 0;
  const hasType = (list: string[]) =>
    anyTypeSelected || propertyTypes.some((t) => list.includes(t));
  // 専有面積 applies to a unit inside a building — a 区分マンション. For a whole
  // building it is 建物/延床面積, matched against the same listing field, so those
  // types get it too.
  const showsUnitArea = hasType([
    "マンション",
    "一棟マンション",
    "アパート",
    "ビル",
  ]);
  const showsLandArea = hasType(LAND_TYPES);
  const showsBuildingAge = hasType(BUILDING_TYPES);
  const showsYield = hasType(INCOME_TYPES);
  const showsAnyAreaField = showsUnitArea || showsLandArea;

  const resetForm = () => {
    setEditingOrderId(null);
    setSaveError(null);
    setOrderName("");
    setWards([]);
    setDealType("buy");
    setPriceMin("");
    setPriceMax("");
    setRentMin("");
    setRentMax("");
    setMaxDeposit("");
    setMaxKeyMoney("");
    setPetsRequired(false);
    setWalkMinutes("");
    setMinBuildingCoverageRatio("");
    setMinFloorAreaRatio("");
    setPropertyTypes([]);
    setOwnerChange(false);
    setLandSizeMin("");
    setLandSizeMax("");
    setBuildingSizeMin("");
    setBuildingSizeMax("");
    setMaxBuildAge("");
    setMinBuildYear("");
    setMinYield("");
    setMaxYield("");
    setMinRoadWidth("");
    setMinTotalUnits("");
    setMaxFloor("");
    setExcludeFirstFloor(false);
    setMinElevators("");
    setStructureTypes([]);
    setLayoutTypes([]);
    setEditingOrderId(null);
    setOrderStatus("pending");
    setSelectedCustomerId("");
  };

  const handleEditClick = (order: Doc<"orders">) => {
    setEditingOrderId(order._id);
    setOrderName(order.name || "");
    setWards(
      order.wards && order.wards.length > 0
        ? order.wards
        : order.ward
          ? [order.ward]
          : [],
    );
    setDealType(order.dealType === "rent" ? "rent" : "buy");
    setPriceMin(order.priceMin !== undefined ? String(order.priceMin) : "");
    setPriceMax(order.priceMax !== undefined ? String(order.priceMax) : "");
    setRentMin(order.rentMin !== undefined ? String(order.rentMin) : "");
    setRentMax(order.rentMax !== undefined ? String(order.rentMax) : "");
    setMaxDeposit(
      order.maxDeposit !== undefined ? String(order.maxDeposit) : "",
    );
    setMaxKeyMoney(
      order.maxKeyMoney !== undefined ? String(order.maxKeyMoney) : "",
    );
    setPetsRequired(!!order.petsRequired);
    setWalkMinutes(
      order.walkMinutes !== undefined
        ? String(order.walkMinutes)
        : order.criteria?.walkMinutes !== undefined
          ? String(order.criteria.walkMinutes)
          : "",
    );
    setMinBuildingCoverageRatio(
      order.minBuildingCoverageRatio !== undefined
        ? String(order.minBuildingCoverageRatio)
        : order.criteria?.minBuildingCoverageRatio !== undefined
          ? String(order.criteria.minBuildingCoverageRatio)
          : "",
    );
    setMinFloorAreaRatio(
      order.minFloorAreaRatio !== undefined
        ? String(order.minFloorAreaRatio)
        : order.criteria?.minFloorAreaRatio !== undefined
          ? String(order.criteria.minFloorAreaRatio)
          : "",
    );
    setPropertyTypes(order.propertyTypes || []);
    setOwnerChange(!!order.ownerChange);
    setLandSizeMin(
      order.landSizeMin !== undefined ? String(order.landSizeMin) : "",
    );
    setLandSizeMax(
      order.landSizeMax !== undefined ? String(order.landSizeMax) : "",
    );
    setBuildingSizeMin(
      order.buildingSizeMin !== undefined ? String(order.buildingSizeMin) : "",
    );
    setBuildingSizeMax(
      order.buildingSizeMax !== undefined ? String(order.buildingSizeMax) : "",
    );
    setMaxBuildAge(
      order.maxBuildAge !== undefined ? String(order.maxBuildAge) : "",
    );
    setMinBuildYear(
      order.minBuildYear !== undefined ? String(order.minBuildYear) : "",
    );
    setMinYield(order.minYield !== undefined ? String(order.minYield) : "");
    setMaxYield(order.maxYield !== undefined ? String(order.maxYield) : "");
    setMinRoadWidth(
      order.minRoadWidth !== undefined ? String(order.minRoadWidth) : "",
    );
    setMinTotalUnits(
      order.minTotalUnits !== undefined ? String(order.minTotalUnits) : "",
    );
    setMaxFloor(order.maxFloor !== undefined ? String(order.maxFloor) : "");
    setExcludeFirstFloor(!!order.excludeFirstFloor);
    setMinElevators(
      order.minElevators !== undefined ? String(order.minElevators) : "",
    );
    setStructureTypes(order.structureTypes || []);
    setLayoutTypes(order.layoutTypes || []);
    setOrderStatus(order.status || "pending");
    setSelectedCustomerId(order.customerId || "");
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // These fields are plain <input type="number"> with no slider, and a
  // browser's `min="0"` only affects the stepper/validity state, not what a
  // person can actually type — a stray "-" produces a criterion like "徒歩 -7
  // 分以内" that real listings (walk time is never negative) can essentially
  // never satisfy, silently starving the search instead of erroring.
  const nonNegNum = (value: string) => {
    if (!value) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, n) : undefined;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setSaveError(null);
    try {
      const orderParams = {
        name: orderName || undefined,
        status: orderStatus,
        customerId: selectedCustomerId || undefined,
        ward: wards.length === 1 ? wards[0] : undefined,
        wards: wards.length > 0 ? wards : undefined,
        dealType,
        // Only the fields for the SELECTED side are ever sent — an edit that
        // flips 買う<->借りる has to clear the other side's stale values, not
        // leave e.g. a rent order still carrying its old priceMax.
        priceMin: dealType === "buy" && priceMin ? Number(priceMin) : undefined,
        priceMax: dealType === "buy" && priceMax ? Number(priceMax) : undefined,
        rentMin: dealType === "rent" && rentMin ? Number(rentMin) : undefined,
        rentMax: dealType === "rent" && rentMax ? Number(rentMax) : undefined,
        maxDeposit:
          dealType === "rent" ? nonNegNum(maxDeposit) : undefined,
        maxKeyMoney:
          dealType === "rent" ? nonNegNum(maxKeyMoney) : undefined,
        // false rather than undefined when not applicable — same reason as
        // ownerChange below: an edit that flips away from 借りる has to clear
        // a previously-ticked ペット可のみ, and patch ignores undefined values.
        petsRequired: dealType === "rent" ? petsRequired : false,
        criteria: {
          walkMinutes: nonNegNum(walkMinutes),
          minBuildingCoverageRatio: nonNegNum(minBuildingCoverageRatio),
          minFloorAreaRatio: nonNegNum(minFloorAreaRatio),
        },
        propertyTypes: propertyTypes.length > 0 ? propertyTypes : undefined,
        // Sent as `false` rather than undefined when unticked: an edit that turns
        // the requirement OFF has to clear the stored value, and Convex patch
        // ignores keys whose value is undefined.
        // オーナーチェンジ (賃貸中のまま売却) only means something for a SALE —
        // the toggle itself is hidden for 借りる, but force it false there too
        // in case it was ticked before switching from 買う.
        ownerChange: dealType === "buy" && ownerChange,
        landSizeMin: landSizeMin ? Number(landSizeMin) : undefined,
        landSizeMax: landSizeMax ? Number(landSizeMax) : undefined,
        buildingSizeMin: buildingSizeMin ? Number(buildingSizeMin) : undefined,
        buildingSizeMax: buildingSizeMax ? Number(buildingSizeMax) : undefined,
        maxBuildAge: nonNegNum(maxBuildAge),
        minBuildYear: minBuildYear ? Number(minBuildYear) : undefined,
        minYield: nonNegNum(minYield),
        maxYield: maxYield ? Number(maxYield) : undefined,
        minRoadWidth: minRoadWidth ? Number(minRoadWidth) : undefined,
        minTotalUnits: minTotalUnits ? Number(minTotalUnits) : undefined,
        maxFloor: maxFloor ? Number(maxFloor) : undefined,
        excludeFirstFloor: excludeFirstFloor || undefined,
        minElevators: minElevators ? Number(minElevators) : undefined,
        structureTypes: structureTypes.length > 0 ? structureTypes : undefined,
        layoutTypes: layoutTypes.length > 0 ? layoutTypes : undefined,
      };

      if (editingOrderId) {
        await updateOrder({
          id: editingOrderId as Id<"orders">,
          ...orderParams,
        });
      } else {
        await createOrder({
          ...orderParams,
          status: "pending",
        });
      }

      setDone(true);
      resetForm();
      setShowForm(false);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      console.error("Failed to save order:", err);
      const message = err instanceof Error ? err.message : String(err);
      // Convex's ArgumentValidationError text is long and English; keep it (it
      // names the offending field, which is the one thing that identifies the
      // problem) but lead with something actionable.
      setSaveError(
        /ArgumentValidationError|Object contains extra field|Unexpected field/i.test(
          message,
        )
          ? "オーダーを保存できませんでした: サーバー側の項目定義が古いため、この条件を受け付けられません。" +
              "バックエンドの再デプロイが必要です。\n\n" +
              message
          : `オーダーを保存できませんでした: ${message}`,
      );
      // The form stays open with the entered values intact — closing it here
      // would discard everything the user just typed.
    } finally {
      setCreating(false);
    }
  };

  const orderMatches = (orderId: string) =>
    matches === undefined
      ? undefined
      : matches.filter((m) => m.orderId === orderId);

  const matchedListing = (listingId: string) =>
    listings?.find((l) => l._id === listingId);

  // Top KPI metrics
  const totalOrdersCount = orders?.length ?? 0;
  const activeOrdersCount =
    orders?.filter((o) => o.status === "pending" || o.status === "active")
      .length ?? 0;
  const completedOrdersCount =
    orders?.filter((o) => o.status === "completed").length ?? 0;
  const scrapingOrdersCount =
    orders?.filter(
      (o) =>
        o.isScraping ||
        (o.scrapingStatus && o.scrapingStatus.includes("検索中")) ||
        isMyRun(o) ||
        localRunOrderId === o._id,
    ).length ?? 0;
  const totalMatchesCount = matches?.length ?? 0;
  const totalEvaluatedCount = Object.keys(evaluations).length;
  const newMatches24hCount = useMemo(
    () =>
      matches?.filter(
        (m) =>
          m._creationTime &&
          Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
      ).length ?? 0,
    [matches],
  );
  const highScoreMatchesCount = useMemo(
    () =>
      matches?.filter((m) => {
        const s = matchScore(m, evaluations);
        return s !== undefined && s >= 80;
      }).length ?? 0,
    [matches, evaluations],
  );
  const ordersWithNewMatchesCount = useMemo(
    () =>
      orders?.filter((o) => {
        const oMatches = orderMatches(o._id);
        return (oMatches ?? []).some(
          (m) =>
            m._creationTime &&
            Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
        );
      }).length ?? 0,
    [orders, matches],
  );
  const ordersWithMatchesCount = useMemo(
    () =>
      orders?.filter((o) => (orderMatches(o._id)?.length ?? 0) > 0).length ?? 0,
    [orders, matches],
  );
  const pendingOrdersCount = useMemo(
    () =>
      orders?.filter(
        (o) =>
          o.status !== "completed" && (orderMatches(o._id)?.length ?? 0) === 0,
      ).length ?? 0,
    [orders, matches],
  );

  // Filtered and sorted orders
  const filteredOrders = useMemo(() => {
    if (!orders) return undefined;
    return orders
      .filter((order) => {
        // Text Search
        if (orderSearchQuery.trim()) {
          const q = orderSearchQuery.toLowerCase().trim();
          const orderName = (order.name || "").toLowerCase();
          const customer = customers?.find((c) => c._id === order.customerId);
          const customerName = (customer?.name || "").toLowerCase();
          const wardStr = [order.ward, ...(order.wards || [])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          const matchesSearch =
            orderName.includes(q) ||
            customerName.includes(q) ||
            wardStr.includes(q);
          if (!matchesSearch) return false;
        }

        // Status Filter
        const oMatches = orderMatches(order._id) || [];
        const matchCount = oMatches.length;
        const isScraping =
          order.isScraping ||
          (order.scrapingStatus && order.scrapingStatus.includes("検索中")) ||
          isMyRun(order) ||
          localRunOrderId === order._id;
        const hasRecent = oMatches.some(
          (m) =>
            m._creationTime &&
            Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
        );

        if (orderStatusFilter === "scraping") return isScraping;
        if (orderStatusFilter === "newMatches") return hasRecent;
        if (orderStatusFilter === "hasMatches") return matchCount > 0;
        if (orderStatusFilter === "pending")
          return order.status !== "completed" && matchCount === 0;
        if (orderStatusFilter === "completed")
          return order.status === "completed";
        return true;
      })
      .sort((a, b) => {
        const listA = orderMatches(a._id) || [];
        const listB = orderMatches(b._id) || [];
        if (orderSortKey === "matchesDesc") {
          return listB.length - listA.length;
        }
        if (orderSortKey === "newMatchesDesc") {
          const recentA = listA.filter(
            (m) =>
              m._creationTime &&
              Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
          ).length;
          const recentB = listB.filter(
            (m) =>
              m._creationTime &&
              Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
          ).length;
          return recentB - recentA;
        }
        if (orderSortKey === "nameAsc") {
          return (a.name || "").localeCompare(b.name || "", "ja");
        }
        return (b._creationTime || 0) - (a._creationTime || 0);
      });
  }, [
    orders,
    orderSearchQuery,
    orderStatusFilter,
    orderSortKey,
    matches,
    customers,
    activeRun,
    localRunOrderId,
  ]);

  return (
    <div className="page-shell space-y-5">
      {/* ── Page Header ── */}
      <div className="page-header">
        <div>
          <div className="eyebrow-pill">Property Search</div>
          <h1 className="page-title">物件検索</h1>
          <p className="page-subtitle">
            買主希望条件の登録、全14不動産ポータル横断検索、物件評価を一括管理
          </p>
        </div>
        <Button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm(!showForm);
          }}
          variant={showForm ? "outline" : "default"}
        >
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? "キャンセル" : "新規オーダー作成"}
        </Button>
      </div>

      {/* ── Mail connection: read broker emails (物件紹介) and auto-match them
          against every order, same as a scraped listing. Read-only — this
          never sends anything (see ProposalModal for that, unrelated). ── */}
      <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
        {/* Header: identity + actions */}
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand)]">
              <Mail className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-[13px] font-semibold tracking-[0.01em] text-[var(--text-primary)]">
                  メール連携
                </h2>
                {(mailAccounts?.length ?? 0) > 0 && (
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
                    {mailAccounts?.length} 件接続中
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[var(--text-muted)]">
                仲介会社からの物件紹介メールを自動で抽出・照合します
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {(mailAccounts?.length ?? 0) > 0 && (
              <Button
                size="sm"
                disabled={syncingMail}
                onClick={() => void handleSyncMailNow()}
              >
                {syncingMail ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                今すぐ同期
              </Button>
            )}
            {/* TEMPORARY diagnostic — remove once the mail parser is trusted. */}
            {(mailAccounts?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={inspecting}
                onClick={() => void handleInspectMail()}
              >
                {inspecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mail className="h-3.5 w-3.5" />
                )}
                同期メールを確認
              </Button>
            )}
            {(mailAccounts?.length ?? 0) > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowMailRules(true)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                取り込み設定
              </Button>
            )}
          </div>
        </div>

        {/* Connected accounts — one row each, status at a glance */}
        {(mailAccounts?.length ?? 0) > 0 && (
          <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
            {(mailAccounts ?? []).map((account) => (
              <div
                key={account._id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 transition-colors hover:bg-[var(--bg-surface-hover)]"
              >
                <span className="w-16 shrink-0 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                  {account.provider === "gmail" ? "Gmail" : "Outlook"}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[var(--text-primary)]">
                  {account.email}
                </span>
                {account.needsReconnect ? (
                  <Badge variant="destructive">要再接続</Badge>
                ) : (
                  <Badge variant="emerald">接続済み</Badge>
                )}
                <button
                  type="button"
                  onClick={() => void disconnectMailAccount({ id: account._id })}
                  className="cursor-pointer text-[10.5px] text-[var(--text-muted)] underline underline-offset-2 transition-colors hover:text-[var(--danger)]"
                >
                  解除
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Last sync / auth problem */}
        {mailNotice && (
          <div className="flex items-start gap-2 border-t border-[var(--border-subtle)] bg-[var(--danger-soft)] px-4 py-2.5 text-[11.5px] leading-relaxed text-[#7d2a24]">
            <AlertTriangle className="mt-[1px] h-3.5 w-3.5 shrink-0" />
            <p className="whitespace-pre-line">{mailNotice}</p>
          </div>
        )}

        {/* Connect a provider */}
        {((mailProviders ?? []).filter((p) => p.available).length > 0 ||
          (mailProviders ?? []).filter((p) => !p.available).length > 0) && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] px-4 py-2.5">
            <span className="mr-1 font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
              受信箱を追加
            </span>
            {(mailProviders ?? [])
              .filter((p) => p.available)
              .filter(
                (p) => !(mailAccounts ?? []).some((a) => a.provider === p.provider),
              )
              .map((p) => (
                <Button
                  key={p.provider}
                  size="sm"
                  variant="outline"
                  disabled={connectingMailProvider === p.provider}
                  onClick={() => void handleConnectMail(p.provider)}
                >
                  {connectingMailProvider === p.provider ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Mail className="h-3.5 w-3.5" />
                  )}
                  {p.label}を接続
                </Button>
              ))}

            {(mailProviders ?? [])
              .filter((p) => !p.available)
              .map((p) => (
                <span
                  key={p.provider}
                  className="text-[11px] text-[var(--text-muted)]"
                  title={p.unavailableReason}
                >
                  {p.label}: 未設定
                </span>
              ))}
          </div>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            icon: FileCheck2,
            color: "var(--brand)",
            bg: "var(--brand-soft)",
            label: "登録された依頼数",
            value: totalOrdersCount,
            loading: orders === undefined,
          },
          {
            icon: CheckCircle2,
            color: "var(--info)",
            bg: "var(--info-soft)",
            label: "検索完了",
            value: activeOrdersCount,
            loading: orders === undefined,
          },
          {
            icon: Building2,
            color: "var(--warning)",
            bg: "var(--warning-soft)",
            label: "全検索結果",
            value: totalMatchesCount,
            loading: matches === undefined,
          },
          {
            icon: FileText,
            color: "var(--success)",
            bg: "var(--success-soft)",
            label: "評価完了数",
            value: totalEvaluatedCount,
            loading: false,
          },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div className="flex items-start justify-between gap-2">
              <span className="stat-label">{kpi.label}</span>
              <span
                className="kpi-icon"
                style={{ background: kpi.bg, color: kpi.color }}
              >
                <kpi.icon className="h-[15px] w-[15px]" />
              </span>
            </div>
            {kpi.loading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <div className="stat-value">{kpi.value}</div>
            )}
          </div>
        ))}
      </div>

      {/* Order Creation / Editing Form */}
      {showForm && (
        <Card className="border-2 border-[var(--brand-border)] shadow-lg rounded-2xl overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
          <CardHeader className="bg-[var(--bg-surface-hover)] border-b border-[var(--border-subtle)] p-5 md:p-6">
            <CardTitle className="text-lg font-extrabold flex items-center gap-2 text-[var(--text-primary)]">
              <SlidersHorizontal className="w-4 h-4 text-[var(--brand)]" />
              {editingOrderId ? "オーダー編集" : "新規買主オーダー作成"}
            </CardTitle>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              買主の希望条件を入力してください。条件に合致する物件を全14ポータルから自動抽出します。
            </p>
          </CardHeader>
          <CardContent className="p-6 md:p-8 space-y-6">
            <form onSubmit={handleCreate} className="space-y-6">
              {/* 買う/借りる — mutually exclusive. Everything below that only
                  applies to one side (価格 vs 賃料, 利回り, 敷金/礼金, etc.) is
                  gated on this, and the scraper side hard-rejects any listing
                  whose own dealType doesn't match (see propertyMatcher.ts). */}
              <div className="space-y-2">
                <Label className="text-sm font-bold text-slate-700">
                  取引種別
                </Label>
                <div className="flex gap-2.5">
                  {(
                    [
                      { value: "buy" as const, label: "買う" },
                      { value: "rent" as const, label: "借りる" },
                    ]
                  ).map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => {
                        setDealType(opt.value);
                        // Drop any selected type the new mode doesn't offer a
                        // button for — otherwise it stays selected-but-invisible
                        // and still gets submitted (e.g. 土地/ビル picked while
                        // 買う, silently carried into a 借りる order after
                        // switching, even though its button is now gone).
                        const validTypes = new Set(
                          (opt.value === "rent"
                            ? RENTAL_PROPERTY_TYPE_GROUPS
                            : PROPERTY_TYPE_GROUPS
                          ).flatMap((g) => g.types),
                        );
                        setPropertyTypes((prev) =>
                          prev.filter((t) => validTypes.has(t)),
                        );
                        if (opt.value === "rent") setOwnerChange(false);
                      }}
                      className={`px-5 py-2.5 rounded-xl text-sm font-bold border transition-all duration-150 ${
                        dealType === opt.value
                          ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                          : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Basic Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  基本条件
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      案件名
                    </Label>
                    <Input
                      placeholder="例: 山田様 渋谷区・港区 商業用地サーチ"
                      value={orderName}
                      onChange={(e) => setOrderName(e.target.value)}
                      className="h-11 text-base rounded-xl border-slate-200 focus:border-emerald-600"
                    />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-emerald-700" />
                        紐付ける顧客 (買主)
                      </Label>
                      <button
                        type="button"
                        onClick={() => navigate("/customers")}
                        className="text-xs font-bold text-emerald-700 hover:underline flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        新規顧客登録
                      </button>
                    </div>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => setSelectedCustomerId(e.target.value)}
                      className="w-full h-11 px-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-700/20 focus:border-emerald-700"
                    >
                      <option value="">
                        -- 顧客を選択しない (指定なし) --
                      </option>
                      {(customers || []).map((c) => (
                        <option key={c._id} value={c._id}>
                          👤 {c.name} {c.company ? `(${c.company})` : ""}{" "}
                          {c.phone ? `- ${c.phone}` : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2 md:col-span-3">
                    <Label className="text-sm font-bold text-slate-700 flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-emerald-700" />
                      対象エリア選択（複数選択可）
                    </Label>
                    <div className="space-y-3">
                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="text-xs font-bold text-slate-500 mb-2">
                          東京23区
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto pr-2">
                          {TOKYO_WARDS.map((w) => {
                            const isSelected = wards.includes(w.label);
                            return (
                              <button
                                type="button"
                                key={w.code}
                                onClick={() =>
                                  setWards((prev) =>
                                    prev.includes(w.label)
                                      ? prev.filter((x) => x !== w.label)
                                      : [...prev, w.label],
                                  )
                                }
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                                  isSelected
                                    ? "bg-emerald-700 text-white shadow-sm"
                                    : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300"
                                }`}
                              >
                                {w.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                        <div className="text-xs font-bold text-slate-500 mb-2">
                          市部 / 郡 / 島嶼部
                        </div>
                        <div className="flex flex-wrap gap-2 max-h-36 overflow-y-auto pr-2">
                          {TOKYO_CITIES.map((c) => {
                            const isSelected = wards.includes(c.label);
                            return (
                              <button
                                type="button"
                                key={c.code}
                                onClick={() =>
                                  setWards((prev) =>
                                    prev.includes(c.label)
                                      ? prev.filter((x) => x !== c.label)
                                      : [...prev, c.label],
                                  )
                                }
                                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                                  isSelected
                                    ? "bg-emerald-700 text-white shadow-sm"
                                    : "bg-white text-slate-700 border border-slate-200 hover:border-emerald-300"
                                }`}
                              >
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="md:col-span-2 grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6 pt-1">
                    {dealType === "buy" ? (
                      <RangeSlider
                        label="価格"
                        hint="スライダーの右端を超える金額は、数値を直接入力してください。"
                        unit="万円"
                        // 5億 covers ordinary residential and small commercial at a
                        // 100万 step that is still draggable; above that the number
                        // box takes over (see the hint).
                        max={50000}
                        step={100}
                        minValue={priceMin}
                        maxValue={priceMax}
                        onMinChange={setPriceMin}
                        onMaxChange={setPriceMax}
                      />
                    ) : (
                      <RangeSlider
                        label="賃料"
                        hint="管理費・共益費は別条件（下記）で指定できます。"
                        unit="万円/月"
                        max={100}
                        step={1}
                        minValue={rentMin}
                        maxValue={rentMax}
                        onMinChange={setRentMin}
                        onMaxChange={setRentMax}
                      />
                    )}

                    {/* Single-bound conditions stay plain inputs: a slider earns
                        its place when there are two ends to balance against each
                        other, and is just a slower way to type one number. */}
                    <div className="space-y-2">
                      <Label className="text-sm font-bold text-slate-700">
                        駅徒歩 (分以内)
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        placeholder="例: 5"
                        value={walkMinutes}
                        onChange={(e) => setWalkMinutes(e.target.value)}
                        className="h-11 text-base rounded-xl"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Property Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  物件種別・面積条件
                </h3>

                <div className="space-y-2">
                  <Label className="text-sm font-bold text-slate-700">
                    物件種別
                  </Label>
                  {dealType === "buy" && (
                    <p className="text-xs text-slate-500 font-medium -mt-1">
                      収益物件をお探しの場合は、種別ではなく下の「最低利回り」で指定してください。
                    </p>
                  )}

                  {/* One row per group, so it is visible which option belongs to
                      which: オーナーチェンジ modifies マンション (区分), and
                      一棟マンション / アパート sit with ビル because they are all
                      whole-building purchases.

                      収益物件 is deliberately absent: it is an investment CATEGORY,
                      not a building shape, no scraper emits that string, and
                      minYield already expresses the same intent. Orders created
                      before this still work via propertyTypeMatches() in
                      scraper-service/src/services/propertyMatcher.ts. */}
                  <div className="space-y-2.5">
                    {(dealType === "rent"
                      ? RENTAL_PROPERTY_TYPE_GROUPS
                      : PROPERTY_TYPE_GROUPS
                    ).map((group) => (
                      <div
                        key={group.label}
                        className="flex flex-wrap items-center gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200"
                      >
                        <span className="text-[11px] font-bold text-slate-500 w-full sm:w-28 shrink-0">
                          {group.label}
                        </span>
                        {group.types.map((t) => {
                          const isSelected = propertyTypes.includes(t);
                          return (
                            <button
                              type="button"
                              key={t}
                              onClick={() =>
                                setPropertyTypes((prev) =>
                                  prev.includes(t)
                                    ? prev.filter((x) => x !== t)
                                    : [...prev, t],
                                )
                              }
                              className={`px-4 py-2 rounded-xl text-sm font-semibold border transition-all duration-150 ${
                                isSelected
                                  ? "bg-emerald-700 text-white border-emerald-700 shadow-sm"
                                  : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                              }`}
                            >
                              {t}
                            </button>
                          );
                        })}
                        {/* Immediately to the right of マンション, in its row. */}
                        {group.ownerChangeToggle && (
                          <label
                            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border cursor-pointer transition-all duration-150 select-none ${
                              ownerChange
                                ? "bg-emerald-50 text-emerald-900 border-emerald-300"
                                : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                            }`}
                            title="賃貸中のマンションをそのまま売却する物件（オーナーチェンジ）のみを抽出します"
                          >
                            <input
                              type="checkbox"
                              checked={ownerChange}
                              onChange={(e) => setOwnerChange(e.target.checked)}
                              className="w-4 h-4 accent-emerald-700 cursor-pointer"
                            />
                            オーナーチェンジ
                          </label>
                        )}
                      </div>
                    ))}
                  </div>

                  {ownerChange && (
                    <p className="text-xs text-emerald-800 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 leading-relaxed">
                      オーナーチェンジ（賃貸中のまま売却）の物件のみを抽出します。
                      各ポータルの掲載文に「オーナーチェンジ」「賃貸中」等の記載があるものを対象とするため、
                      賃貸状況が詳細ページにしか書かれていない物件は抽出されないことがあります。
                    </p>
                  )}
                </div>

                {/* Only the conditions that mean something for the chosen types.
                    専有面積 is meaningless for 土地, 建ぺい率 for a 区分マンション,
                    利回り for raw land — showing them all invited conditions that
                    silently match nothing. With no type chosen the order means
                    "any", so everything is shown. */}
                {!showsAnyAreaField && (
                  <p className="text-xs text-slate-500 font-medium">
                    物件種別を選ぶと、その種別に関係する条件のみが表示されます。
                  </p>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                  {showsUnitArea && (
                    <RangeSlider
                      label="専有面積"
                      hint="マンションの面積は専有面積（室内の面積）で判定します。"
                      unit="㎡"
                      max={200}
                      step={5}
                      minValue={buildingSizeMin}
                      maxValue={buildingSizeMax}
                      onMinChange={setBuildingSizeMin}
                      onMaxChange={setBuildingSizeMax}
                    />
                  )}

                  {dealType === "buy" && showsLandArea && (
                    <RangeSlider
                      label="土地面積"
                      unit="㎡"
                      max={1000}
                      step={10}
                      minValue={landSizeMin}
                      maxValue={landSizeMax}
                      onMinChange={setLandSizeMin}
                      onMaxChange={setLandSizeMax}
                    />
                  )}

                  {/* The remaining conditions are single bounds, so they stay
                      plain number inputs — see the note by 駅徒歩. They are laid
                      out in their own sub-grid so one-line inputs do not stretch
                      to the height of a slider block. */}
                  <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    {dealType === "buy" && showsLandArea && (
                      <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-700">
                          最低建ぺい率 (%)
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          placeholder="例: 80"
                          value={minBuildingCoverageRatio}
                          onChange={(e) =>
                            setMinBuildingCoverageRatio(e.target.value)
                          }
                          className="h-11 text-base rounded-xl"
                        />
                      </div>
                    )}

                    {dealType === "buy" && showsLandArea && (
                      <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-700">
                          最低容積率 (%)
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          placeholder="例: 200"
                          value={minFloorAreaRatio}
                          onChange={(e) => setMinFloorAreaRatio(e.target.value)}
                          className="h-11 text-base rounded-xl"
                        />
                        <p className="text-[11px] text-slate-500 font-medium">
                          都心の商業地では 600〜1300% になることもあります。
                        </p>
                      </div>
                    )}

                    {showsBuildingAge && (
                      <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-700">
                          築年数以内 (年)
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          placeholder="例: 30"
                          value={maxBuildAge}
                          onChange={(e) => setMaxBuildAge(e.target.value)}
                          className="h-11 text-base rounded-xl"
                        />
                      </div>
                    )}

                    {dealType === "buy" && showsYield && (
                      <div className="space-y-2">
                        <Label className="text-sm font-bold text-slate-700">
                          最低利回り (%)
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          placeholder="例: 5.5"
                          value={minYield}
                          onChange={(e) => setMinYield(e.target.value)}
                          className="h-11 text-base rounded-xl"
                        />
                      </div>
                    )}

                    {dealType === "rent" && (
                      <>
                        <div className="space-y-2">
                          <Label className="text-sm font-bold text-slate-700">
                            敷金上限 (万円)
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="例: 30"
                            value={maxDeposit}
                            onChange={(e) => setMaxDeposit(e.target.value)}
                            className="h-11 text-base rounded-xl"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-sm font-bold text-slate-700">
                            礼金上限 (万円)
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            placeholder="例: 30"
                            value={maxKeyMoney}
                            onChange={(e) => setMaxKeyMoney(e.target.value)}
                            className="h-11 text-base rounded-xl"
                          />
                        </div>
                        <label
                          className={`flex items-center gap-1.5 h-11 px-3.5 rounded-xl text-sm font-semibold border cursor-pointer transition-all duration-150 select-none self-end ${
                            petsRequired
                              ? "bg-emerald-50 text-emerald-900 border-emerald-300"
                              : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={petsRequired}
                            onChange={(e) => setPetsRequired(e.target.checked)}
                            className="w-4 h-4 accent-emerald-700 cursor-pointer"
                          />
                          ペット可のみ
                        </label>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Form Buttons */}
              {saveError && (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs font-bold whitespace-pre-wrap leading-relaxed">
                  {saveError}
                </div>
              )}
              <div className="flex items-center gap-4 pt-4 border-t border-[var(--border-subtle)]">
                <Button type="submit" disabled={creating} size="lg">
                  {creating
                    ? "保存中..."
                    : editingOrderId
                      ? "変更内容を保存"
                      : "作成"}
                </Button>
                {done && (
                  <span className="text-sm font-bold text-[var(--brand)] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {editingOrderId
                      ? "オーダーを更新しました"
                      : "オーダーを作成しました"}
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── KPI Dashboard Overview ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Total Orders */}
        <div
          onClick={() => setOrderStatusFilter("all")}
          className={`p-4 rounded-xl border bg-white transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
            orderStatusFilter === "all"
              ? "border-emerald-600 ring-1 ring-emerald-600/30"
              : "border-[var(--border-subtle)] hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              総オーダー
            </span>
            <Building2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-data">
            {totalOrdersCount}
            <span className="text-xs font-bold text-slate-400 ml-1">件</span>
          </div>
          <div className="text-[11px] font-semibold text-slate-500 mt-1 flex items-center gap-1">
            <span>進行中: {activeOrdersCount}件</span>
            <span className="text-slate-300">•</span>
            <span>完了: {completedOrdersCount}件</span>
          </div>
        </div>

        {/* Active Scraping Runs */}
        <div
          onClick={() => setOrderStatusFilter("scraping")}
          className={`p-4 rounded-xl border bg-white transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
            orderStatusFilter === "scraping"
              ? "border-emerald-600 ring-1 ring-emerald-600/30"
              : "border-[var(--border-subtle)] hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              検索中オーダー
            </span>
            <RefreshCw
              className={`w-4 h-4 ${
                scrapingOrdersCount > 0
                  ? "text-emerald-600 animate-spin"
                  : "text-slate-400"
              }`}
            />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 font-data">
              {scrapingOrdersCount}
            </span>
            <span className="text-xs font-bold text-slate-400">件</span>
            {scrapingOrdersCount > 0 && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </div>
          <div className="text-[11px] font-semibold text-slate-500 mt-1">
            {scrapingOrdersCount > 0 ? "リアルタイム収集中" : "現在待機中"}
          </div>
        </div>

        {/* New Matches (Today / 24h) */}
        <div
          onClick={() => setOrderStatusFilter("newMatches")}
          className={`p-4 rounded-xl border bg-white transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
            orderStatusFilter === "newMatches"
              ? "border-emerald-600 ring-1 ring-emerald-600/30"
              : "border-[var(--border-subtle)] hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
              本日の新着
            </span>
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-700 font-data">
            +{newMatches24hCount}
            <span className="text-xs font-bold text-emerald-600 ml-1">件</span>
          </div>
          <div className="text-[11px] font-semibold text-emerald-600/90 mt-1">
            {ordersWithNewMatchesCount}件のオーダーで新着あり
          </div>
        </div>

        {/* High Score Matches (80+ S/A rank) */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-white shadow-2xs hover:border-slate-300 transition-all">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              高評価物件
            </span>
            <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-data">
            {highScoreMatchesCount}
            <span className="text-xs font-bold text-slate-400 ml-1">件</span>
          </div>
          <div className="text-[11px] font-semibold text-amber-700 mt-1">
            スコア80点以上（即提案候補）
          </div>
        </div>

        {/* Total Matched Listings */}
        <div
          onClick={() => setOrderStatusFilter("hasMatches")}
          className={`p-4 rounded-xl border bg-white transition-all cursor-pointer shadow-2xs hover:shadow-xs ${
            orderStatusFilter === "hasMatches"
              ? "border-emerald-600 ring-1 ring-emerald-600/30"
              : "border-[var(--border-subtle)] hover:border-slate-300"
          }`}
        >
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">
              総マッチ物件数
            </span>
            <CheckCircle2 className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-data">
            {totalMatchesCount.toLocaleString()}
            <span className="text-xs font-bold text-slate-400 ml-1">件</span>
          </div>
          <div className="text-[11px] font-semibold text-slate-500 mt-1">
            {ordersWithMatchesCount}件のオーダーにマッチ
          </div>
        </div>
      </div>

      {/* Orders List Section */}
      <div className="space-y-4">
        {/* Search, Filter & Sort Controls */}
        <div className="space-y-3 bg-white p-4 rounded-2xl border border-[var(--border-subtle)] shadow-2xs">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={orderSearchQuery}
                onChange={(e) => setOrderSearchQuery(e.target.value)}
                placeholder="オーダー名・顧客名・エリア（区/市/駅）で検索..."
                className="w-full h-9 pl-9 pr-8 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-white focus:bg-white focus:border-emerald-600 focus:outline-none transition-colors"
              />
              {orderSearchQuery && (
                <button
                  type="button"
                  onClick={() => setOrderSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Sort & Bulk Toggle */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 font-bold">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={orderSortKey}
                  onChange={(e) => setOrderSortKey(e.target.value as any)}
                  className="h-9 px-2.5 text-xs font-bold rounded-lg border border-slate-200 bg-white text-slate-700 cursor-pointer focus:outline-none hover:border-slate-300"
                >
                  <option value="newest">作成日が新しい順</option>
                  <option value="newMatchesDesc">新着マッチが多い順</option>
                  <option value="matchesDesc">マッチ件数が多い順</option>
                  <option value="nameAsc">オーダー名順</option>
                </select>
              </div>

              {/* Expand/Collapse All */}
              {filteredOrders && filteredOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allExpanded = filteredOrders.every((o) =>
                      expandedOrders.has(o._id),
                    );
                    if (allExpanded) {
                      setExpandedOrders(new Set());
                    } else {
                      setExpandedOrders(
                        new Set(filteredOrders.map((o) => o._id)),
                      );
                    }
                  }}
                  className="h-9 flex items-center gap-1.5 px-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 transition-colors cursor-pointer select-none"
                >
                  {filteredOrders.every((o) => expandedOrders.has(o._id)) ? (
                    <>
                      <ChevronUp className="w-3.5 h-3.5" />
                      折りたたむ
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-3.5 h-3.5" />
                      すべて展開
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100">
            {[
              { key: "all", label: "すべて", count: totalOrdersCount },
              ...(ordersWithNewMatchesCount > 0
                ? [
                    {
                      key: "newMatches",
                      label: "⚡ 本日の新着あり",
                      count: ordersWithNewMatchesCount,
                      highlight: true,
                    },
                  ]
                : []),
              ...(scrapingOrdersCount > 0
                ? [
                    {
                      key: "scraping",
                      label: "🔄 検索中",
                      count: scrapingOrdersCount,
                      highlight: true,
                    },
                  ]
                : []),
              {
                key: "hasMatches",
                label: "マッチあり",
                count: ordersWithMatchesCount,
              },
              { key: "pending", label: "未検索", count: pendingOrdersCount },
              { key: "completed", label: "完了", count: completedOrdersCount },
            ].map((tab) => {
              const isActive = orderStatusFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setOrderStatusFilter(tab.key as any)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                    isActive
                      ? "bg-emerald-700 text-white shadow-xs"
                      : tab.highlight
                        ? "bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-white text-slate-700 border border-slate-200"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Live GitHub Actions run banner */}
        {activeRun && (orders ?? []).some(isMyRun) && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-[var(--brand-soft)] border border-[var(--brand-border)] shadow-xs">
            <RefreshCw className="w-4 h-4 text-[var(--brand)] animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#14532d]">
                {activeRun.status === "queued"
                  ? "物件検索の実行を待機中です"
                  : "物件検索を実行中です"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                完了まで数分〜数十分かかります。物件は取得され次第、自動で一覧に追加されます。
                {activeRun.created_at &&
                  ` （開始: ${formatJaTime(new Date(activeRun.created_at).getTime())}）`}
              </div>
            </div>
          </div>
        )}

        {filteredOrders === undefined ? (
          <div className="space-y-3">
            {[1, 2].map((n) => (
              <Card key={n} className="p-6">
                <div className="space-y-3">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-14 w-full" />
                </div>
              </Card>
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="empty-state p-12 text-center bg-white rounded-2xl border border-[var(--border-subtle)] space-y-3">
            <Search className="w-10 h-10 text-[var(--text-muted)]/40 mx-auto" />
            <p className="text-sm font-bold text-[var(--text-secondary)]">
              {orders && orders.length > 0
                ? "条件に一致するオーダーが見つかりませんでした"
                : "登録済みオーダーがありません"}
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {orders && orders.length > 0
                ? "検索キーワードやステータスタブの絞り込みを変更してください。"
                : "「新規オーダー作成」から希望条件を登録してください。"}
            </p>
            {orders && orders.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setOrderSearchQuery("");
                  setOrderStatusFilter("all");
                }}
              >
                フィルターを解除
              </Button>
            )}
          </div>
        ) : (
          filteredOrders.map((order) => {
            const orderMatchList = orderMatches(order._id);
            const matchCount = orderMatchList?.length ?? 0;
            const recentMatchesInOrder = (orderMatchList ?? []).filter(
              (m) =>
                m._creationTime &&
                Date.now() - m._creationTime <= 24 * 60 * 60 * 1000,
            ).length;
            const selectedCountForOrder = (orderMatchList ?? []).filter((m) =>
              selectedForProposal.has(m._id),
            ).length;
            const isCardExpanded = expandedOrders.has(order._id);

            return (
              <Card
                key={order._id}
                className="overflow-hidden hover:border-[var(--border-strong)] transition-all duration-150"
              >
                <CardHeader className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface-hover)] p-5">
                  <div className="flex flex-col gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className="flex items-center justify-between gap-3 cursor-pointer group select-none py-0.5"
                        onClick={() => toggleOrderExpanded(order._id)}
                        title={isCardExpanded ? "クリックして物件一覧を折りたたむ" : "クリックして物件一覧を展開"}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="group-hover:text-[var(--brand)] transition-colors flex items-center gap-2">
                            <span className={`inline-flex items-center justify-center w-5 h-5 rounded transition-transform duration-200 text-[var(--text-muted)] group-hover:text-[var(--brand)] ${isCardExpanded ? "rotate-90 text-[var(--brand)]" : ""}`}>
                              <ChevronRight className="w-4 h-4" />
                            </span>
                            <span>{order.name || `オーダー #${order._id.slice(0, 6)}`}</span>
                          </CardTitle>
                          {(order.status === "completed" || matchCount === 0) && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const nextStatus =
                                  order.status === "completed"
                                    ? "pending"
                                    : "completed";
                                await updateOrder({
                                  id: order._id,
                                  status: nextStatus,
                                });
                              }}
                              className={`text-[11px] px-2.5 py-1 font-bold shrink-0 transition-all select-none rounded-lg ${
                                order.status === "completed"
                                  ? "bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
                                  : "bg-[#e4e7e4] text-[var(--text-secondary)] hover:bg-[#d8dbd8]"
                              }`}
                              title="クリックで完了/未完了を切り替えます"
                            >
                              {order.status === "completed" ? "✓ 完了" : "未検索"}
                            </button>
                          )}
                          {isMyRun(order) && (
                            <Badge
                              variant="brand"
                              className="gap-1.5 font-bold py-1 px-2.5 shrink-0"
                            >
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>
                                {activeRun?.status === "queued"
                                  ? "取得待機中"
                                  : "取得中"}
                              </span>
                            </Badge>
                          )}
                          {matchCount > 0 && (
                            <Badge className="font-extrabold cursor-pointer">
                              {matchCount} 件
                            </Badge>
                          )}
                          {recentMatchesInOrder > 0 && (
                            <Badge className="font-extrabold bg-emerald-600 hover:bg-emerald-700 text-white border-0 shadow-xs gap-1 py-1 px-2.5">
                              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                              +{recentMatchesInOrder} 件の新着
                            </Badge>
                          )}
                          {order.dealType === "rent" && (
                            <Badge variant="neutral">借りる</Badge>
                          )}

                          {(() => {
                            const customer = customers?.find(
                              (c) => c._id === order.customerId,
                            );
                            if (!customer) return null;
                            return (
                              <Badge variant="neutral" className="gap-1">
                                <Users className="w-3 h-3" />
                                {customer.name}
                                {customer.phone ? ` (${customer.phone})` : ""}
                              </Badge>
                            );
                          })()}
                        </div>

                        {/* Top-right collapse/expand indicator */}
                        <div className="shrink-0 flex items-center gap-1.5 text-xs text-[var(--text-muted)] group-hover:text-[var(--brand)] font-semibold transition-colors">
                          <span className="text-[11px] hidden sm:inline">
                            {isCardExpanded ? "折りたたむ" : "展開する"}
                          </span>
                          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] group-hover:border-[var(--brand-border)] transition-all ${isCardExpanded ? "rotate-180 text-[var(--brand)]" : ""}`}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>

                      {/* Criteria Details */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-xs font-medium text-[var(--text-secondary)]">
                        {(order.wards?.length
                          ? order.wards
                          : order.ward
                            ? [order.ward]
                            : []
                        ).map((w) => (
                          <span
                            key={w}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--brand-soft)] text-[#14532d] text-[11px] font-bold whitespace-nowrap"
                          >
                            <MapPin className="w-3 h-3" />
                            {w}
                          </span>
                        ))}
                        <span className="text-[var(--border-strong)]">·</span>
                        {order.dealType === "rent" ? (
                          <span>
                            賃料:{" "}
                            <strong className="text-[var(--text-primary)]">
                              {order.rentMin && order.rentMax
                                ? `${order.rentMin.toLocaleString()} 〜 ${order.rentMax.toLocaleString()}`
                                : order.rentMin
                                  ? `${order.rentMin.toLocaleString()} 〜`
                                  : order.rentMax
                                    ? `〜 ${order.rentMax.toLocaleString()}`
                                    : "指定なし"}{" "}
                              万円/月
                            </strong>
                          </span>
                        ) : (
                          <span>
                            価格:{" "}
                            <strong className="text-[var(--text-primary)]">
                              {order.priceMin && order.priceMax
                                ? `${order.priceMin.toLocaleString()} 〜 ${order.priceMax.toLocaleString()}`
                                : order.priceMin
                                  ? `${order.priceMin.toLocaleString()} 〜`
                                  : order.priceMax
                                    ? `〜 ${order.priceMax.toLocaleString()}`
                                    : "指定なし"}{" "}
                              万円
                            </strong>
                          </span>
                        )}
                        {(order.walkMinutes ?? order.criteria?.walkMinutes) && (
                          <>
                            <span className="text-[var(--border-strong)]">
                              ·
                            </span>
                            <span>
                              徒歩{" "}
                              {order.walkMinutes ?? order.criteria?.walkMinutes}{" "}
                              分以内
                            </span>
                          </>
                        )}
                        {order.propertyTypes &&
                          order.propertyTypes.length > 0 && (
                            <>
                              <span className="text-[var(--border-strong)]">
                                ·
                              </span>
                              <span>{order.propertyTypes.join("・")}</span>
                            </>
                          )}
                        {order.ownerChange && (
                          <>
                            <span className="text-[var(--border-strong)]">
                              ·
                            </span>
                            <span className="font-bold text-emerald-800">
                              オーナーチェンジ
                            </span>
                          </>
                        )}
                        {(order.buildingSizeMin || order.buildingSizeMax) && (
                          <>
                            <span className="text-[var(--border-strong)]">
                              ·
                            </span>
                            <span>
                              専有面積:{" "}
                              <strong className="text-[var(--text-primary)]">
                                {order.buildingSizeMin && order.buildingSizeMax
                                  ? `${order.buildingSizeMin} 〜 ${order.buildingSizeMax}`
                                  : order.buildingSizeMin
                                    ? `${order.buildingSizeMin} 〜`
                                    : `〜 ${order.buildingSizeMax}`}{" "}
                                ㎡
                              </strong>
                            </span>
                          </>
                        )}
                      </div>

                      {/* When the search last ran and who asked for it. Without
                          this the listings on the card carry no date at all, so
                          there was no way to tell today's results from a sweep
                          run weeks ago. */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px] font-semibold text-[var(--text-muted)]">
                        <Clock className="w-3 h-3" />
                        {order.lastScrapeAt ? (
                          <span>
                            最終検索:{" "}
                            <strong className="text-[var(--text-secondary)]">
                              {formatJaDateTimeShort(order.lastScrapeAt)}
                            </strong>
                          </span>
                        ) : (
                          <span>最終検索: 記録なし</span>
                        )}
                        <span className="text-[var(--border-strong)]">·</span>
                        {/* Always rendered, including the 記録なし case: an absent
                            row read as "this field does not exist" rather than
                            "this search predates the attribution". A person's name
                            for a search someone pressed; the automatic label,
                            badged, for the scheduled sweep (stamped by
                            scraper-service/src/cli.ts). */}
                        {!order.lastScrapeBy ? (
                          <span title="この検索は実行者を記録する前のものです。次回の検索から記録されます。">
                            実行者: 記録なし
                          </span>
                        ) : isAutomaticTrigger(order.lastScrapeBy) ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#eef2f7] text-[#475569] text-[11px] font-bold">
                            <Bot className="w-3 h-3" />
                            {order.lastScrapeBy}
                          </span>
                        ) : (
                          <span>
                            実行者:{" "}
                            <strong className="text-[var(--text-secondary)]">
                              {order.lastScrapeBy}
                            </strong>
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Controls */}
                    <div className="flex flex-wrap items-center gap-2">
                      {isMyRun(order) ||
                      scrapingOrderId === order._id ||
                      order.isScraping ||
                      (order.scrapingStatus &&
                        order.scrapingStatus.includes("検索中")) ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-2 px-3.5 py-2 bg-emerald-50 text-emerald-900 text-xs font-bold rounded-xl border border-emerald-200 shadow-xs">
                            <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />
                            <span>
                              {getOrderSiteLabel(order) || "物件検索中..."}
                            </span>
                          </div>

                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={cancellingOrderId === order._id}
                            onClick={() => void handleCancelScrape(order)}
                            className="h-9 px-3.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                            title={
                              (order.lastScrapeBy ?? "").includes("ローカル実行")
                                ? "このPC上で実行中のローカルスクレイピングを停止します"
                                : "GitHub Actions で実行中のスクレイピング処理を停止します"
                            }
                          >
                            {cancellingOrderId === order._id ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                中止処理中...
                              </>
                            ) : (
                              <>
                                <X className="w-3.5 h-3.5" />
                                検索を中止
                              </>
                            )}
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-xl">
                            <select
                              className="h-9 text-xs font-bold bg-white text-slate-800 px-2 rounded-lg border border-slate-200 cursor-pointer focus:outline-none"
                              value={scrapeSource[order._id] || "all"}
                              onChange={(e) =>
                                setScrapeSource((prev) => ({
                                  ...prev,
                                  [order._id]: e.target.value,
                                }))
                              }
                            >
                              {/* Default. Scraping every portal is the normal
                                  action; picking one is the exception, so it
                                  leads the list and is the fallback value. */}
                              <option value="all">すべてのサイト</option>
                              <option value="athome">At Home</option>
                              <option value="suumo">SUUMO</option>
                              <option value="homes">LIFULL HOME'S</option>
                              <option value="hatomark">鳩マーク</option>
                              <option value="kenbiya">健美家</option>
                              <option value="rakuten">楽天</option>
                              <option value="nomu">ノムコム</option>
                              <option value="nomu_pro">ノムコム・プロ</option>
                              <option value="mitsui">三井のリハウス</option>
                              <option value="stepon">住友不動産ステップ</option>
                              <option value="tokyu">東急リバブル</option>
                              <option value="mizuho">みずほ不動産販売</option>
                              <option value="mitsubishi_ufj">
                                三菱UFJ不動産販売
                              </option>
                              <option value="odakyu">小田急不動産仲介</option>
                              <option value="keio">京王不動産仲介</option>
                              <option value="asahi">朝日住宅</option>
                              <option value="haseko">長谷工の仲介</option>
                              <option value="daikyo">大京穴吹不動産</option>
                              <option value="tokyotatemono">
                                東京建物不動産販売
                              </option>
                            </select>
                            <Button
                              size="sm"
                              onClick={() => handleScrapeOrder(order)}
                              title={
                                runner === "local"
                                  ? "このPCのスクレイパー（作業中のコード）で取得します。別ターミナルで npm run dev:scraper が必要です。"
                                  : "GitHub Actions（公開済みコード）で取得します。PCを閉じても実行が続きます。"
                              }
                            >
                              <Play className="h-3.5 w-3.5" />
                              手動検索
                            </Button>
                          </div>

                          {/* Where the scrape runs. GitHub executes the COMMITTED
                              code and survives closing the laptop; ローカル runs the
                              working tree, which is the only way to test a scraper
                              change before pushing it — and only works from
                              localhost, so it is not offered elsewhere. */}
                          {IS_LOCALHOST ? (
                            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] p-0.5">
                              {(
                                [
                                  { key: "github", label: "GitHub", icon: Cloud },
                                  {
                                    key: "local",
                                    label: "ローカル",
                                    icon: Laptop,
                                  },
                                ] as const
                              ).map((opt) => (
                                <button
                                  key={opt.key}
                                  type="button"
                                  onClick={() => chooseRunner(opt.key)}
                                  title={
                                    opt.key === "local"
                                      ? "このPCで実行（作業中のコードをそのまま使用。npm run dev:scraper が必要）"
                                      : "GitHub Actions で実行（公開済みコード。PCを閉じても継続）"
                                  }
                                  className={`flex h-[30px] cursor-pointer items-center gap-1.5 rounded-[4px] px-2.5 text-[11px] font-medium transition-colors ${
                                    runner === opt.key
                                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(23,21,15,0.06)]"
                                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                                  }`}
                                >
                                  <opt.icon className="h-3.5 w-3.5" />
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <span
                              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] px-2.5 text-[11px] font-medium text-[var(--text-muted)]"
                              title="GitHub Actions で実行（公開済みコード。PCを閉じても継続）"
                            >
                              <Cloud className="h-3.5 w-3.5" />
                              GitHub Actions
                            </span>
                          )}

                          {matchCount > 0 && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleBatchEvaluate(order)}
                                title="通常は取得後に自動評価されます。タブを閉じていた等で未評価が残った場合の予備操作です。"
                                disabled={evaluatingOrderId === order._id}
                              >
                                {evaluatingOrderId === order._id ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand)]" />
                                    評価中
                                    {evalProgress[order._id] &&
                                    evalProgress[order._id].total > 0
                                      ? ` (${evalProgress[order._id].current}/${evalProgress[order._id].total})`
                                      : "..."}
                                  </>
                                ) : (
                                  <>
                                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                                    未評価を評価
                                  </>
                                )}
                              </Button>

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleBatchEvaluate(order, true)}
                                title="評価済みの物件も含め、この注文の全物件を評価し直します。"
                                disabled={evaluatingOrderId === order._id}
                              >
                                {evaluatingOrderId === order._id ? (
                                  <>
                                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand)]" />
                                    評価中
                                    {evalProgress[order._id] &&
                                    evalProgress[order._id].total > 0
                                      ? ` (${evalProgress[order._id].current}/${evalProgress[order._id].total})`
                                      : "..."}
                                  </>
                                ) : (
                                  <>
                                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                                    全て再評価
                                  </>
                                )}
                              </Button>

                              {/* Disabled until something is ticked: opening the
                                  modal with an empty selection just showed an
                                  empty proposal, so the button promised an action
                                  it could not complete. Counts only THIS order's
                                  selections — the set is keyed by matchId and
                                  shared across cards. */}
                              <Button
                                size="sm"
                                disabled={selectedCountForOrder === 0}
                                title={
                                  selectedCountForOrder === 0
                                    ? "提案する物件を下の一覧から選択してください"
                                    : `選択中の ${selectedCountForOrder} 件を提案します`
                                }
                                className={
                                  selectedCountForOrder === 0
                                    ? "opacity-50"
                                    : ""
                                }
                                onClick={() => setProposalOrder(order)}
                              >
                                <Send className="w-3 h-3" />
                                顧客へ提案・送信
                                {selectedCountForOrder > 0 &&
                                  ` (${selectedCountForOrder})`}
                              </Button>
                            </>
                          )}
                        </>
                      )}

                      <div className="flex items-center gap-1.5 ml-auto shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditClick(order)}
                          title="このオーダーを編集"
                        >
                          <Edit className="w-3.5 h-3.5" />
                          編集
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const label = order.name || `オーダー #${order._id.slice(0, 6)}`;
                            if (window.confirm(`「${label}」を削除しますか？\nこの操作は取り消せません。`)) {
                              handleDelete(order._id);
                            }
                          }}
                          title="このオーダーを削除"
                          className="hover:text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          削除
                        </Button>
                      </div>
                    </div>

                    {/* Active Scrape Live Status Banner */}
                    {(order.isScraping || (order.scrapingStatus && order.scrapingStatus.includes("検索中")) || isMyRun(order) || localRunOrderId === order._id) ? (
                      <div className="mt-2.5 p-3.5 rounded-xl text-xs font-bold leading-relaxed bg-emerald-50 text-emerald-950 border border-emerald-200 flex flex-wrap items-center justify-between gap-3 shadow-2xs animate-in fade-in duration-200">
                        <div className="flex items-center gap-3 min-w-0">
                          <Loader2 className="w-4 h-4 animate-spin text-emerald-700 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-extrabold text-emerald-900 text-sm flex items-center gap-2 flex-wrap">
                              <span>現在スクレイピング中:</span>
                              <span className="text-emerald-950 font-mono bg-white px-2 py-0.5 rounded border border-emerald-300 shadow-2xs">
                                {getOrderSiteLabel(order)}
                              </span>
                            </div>
                            <div className="text-[11px] font-normal text-emerald-700 mt-0.5">
                              {localRunOrderId === order._id ? "ローカル（このPC）でスクレイパーを実行しています。" : "GitHub Actions クラウドで実行中。"} 取得された物件はリアルタイムで自動反映されます。
                            </div>
                          </div>
                        </div>
                        {order.activeSource && SOURCE_LABELS[order.activeSource] && (
                          <span className="px-2.5 py-1 bg-white text-emerald-800 border border-emerald-300 rounded-md text-[11px] font-bold shrink-0">
                            {SOURCE_LABELS[order.activeSource]}
                          </span>
                        )}
                      </div>
                    ) : scrapeNotice[order._id] ? (
                      <div
                        className={`mt-2 p-3 rounded-xl text-xs font-bold leading-relaxed whitespace-pre-line ${
                          scrapeNotice[order._id].kind === "error"
                            ? "bg-red-50 text-red-700 border border-red-200"
                            : "bg-[var(--brand-soft)] text-[#14532d] border border-[var(--brand-border)]"
                        }`}
                      >
                        {scrapeNotice[order._id].text}
                      </div>
                    ) : null}
                  </div>
                </CardHeader>

                {/* Matched Listings Drawer */}
                {isCardExpanded && (
                  <CardContent className="p-5 space-y-2">
                    {matchCount > 0 && orderMatchList ? (
                      <>
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 space-y-2">
                        <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                          抽出物件一覧 ({matchCount}件)
                        </div>

                        {/* Quick filters, with live counts. Built from these
                            results, so a 477-row list can be cut to "高評価" or a
                            single 物件種別 without touching the order's criteria. */}
                        {(() => {
                          const scoreOf = (m: Doc<"matching">) =>
                            matchScore(m, evaluations);
                          const chips = buildListingFilters(
                            orderMatchList,
                            matchedListing,
                            scoreOf,
                          );
                          if (chips.length === 0) return null;
                          const active = listFilter[order._id] ?? "all";
                          return (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {chips.map((chip) => {
                                const isActive = active === chip.key;
                                return (
                                  <button
                                    key={chip.key}
                                    type="button"
                                    onClick={() => {
                                      setListFilter((prev) => ({
                                        ...prev,
                                        [order._id]: chip.key,
                                      }));
                                      // Filtering changes what page 4 even means.
                                      setCurrentPage((prev) => ({
                                        ...prev,
                                        [order._id]: 1,
                                      }));
                                    }}
                                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
                                      isActive
                                        ? "bg-emerald-700 text-white border-emerald-700 shadow-xs"
                                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                                    }`}
                                  >
                                    {chip.label}
                                    <span
                                      className={`ml-1 font-black ${isActive ? "text-white/80" : "text-slate-400"}`}
                                    >
                                      {chip.count}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>

                      <label className="flex items-center gap-2 text-[11px] font-bold text-[var(--text-muted)]">
                        並び順
                        <select
                          value={sortKey[order._id] || "newest"}
                          onChange={(e) => {
                            setSortKey((prev) => ({
                              ...prev,
                              [order._id]: e.target.value as SortKey,
                            }));
                            // Page 1: staying on page 4 of a re-sorted list shows
                            // a slice the user did not ask to see.
                            setCurrentPage((prev) => ({
                              ...prev,
                              [order._id]: 1,
                            }));
                          }}
                          className="h-8 px-2 bg-white text-slate-800 text-xs font-bold rounded-lg border border-slate-200 cursor-pointer focus:outline-none"
                        >
                          {SORT_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {(() => {
                      const pageSize = showLimit[order._id] || 10;
                      const page = currentPage[order._id] || 1;
                      const activeSort: SortKey = sortKey[order._id] || "newest";
                      // When a listing lacks the sort field it goes last in every
                      // ordering rather than being treated as 0 円 / 1970年.
                      const LAST = Number.POSITIVE_INFINITY;
                      const activeFilter = listFilter[order._id] ?? "all";
                      const visibleMatches = orderMatchList.filter((m) =>
                        passesListingFilter(
                          activeFilter,
                          m,
                          matchedListing(m.listingId ?? ""),
                          matchScore(m, evaluations),
                        ),
                      );
                      const sortedMatches = [...visibleMatches].sort((a, b) => {
                        // Ties fall back to a fixed key: the API returns rows in
                        // Postgres heap order, which shifts on every update/refetch.
                        return compareMatches(a, b) || a._id.localeCompare(b._id);
                      });
                      function compareMatches(a: Doc<"matching">, b: Doc<"matching">): number {
                        const la = matchedListing(a.listingId ?? "");
                        const lb = matchedListing(b.listingId ?? "");
                        // A broker emailed this directly — surface it ahead of
                        // everything scraped off a public portal, regardless
                        // of whatever sort the user picked.
                        const emailRank = (l: Doc<"listings"> | undefined) =>
                          l?.source === "email" ? 0 : 1;
                        const rankDiff = emailRank(la) - emailRank(lb);
                        if (rankDiff !== 0) return rankDiff;
                        switch (activeSort) {
                          case "priceAsc":
                            return (la?.price ?? LAST) - (lb?.price ?? LAST);
                          case "priceDesc":
                            return (lb?.price ?? -LAST) - (la?.price ?? -LAST);
                          case "newest":
                            return (
                              (listingDate(lb) ?? -LAST) -
                              (listingDate(la) ?? -LAST)
                            );
                          case "oldest":
                            return (
                              (listingDate(la) ?? LAST) -
                              (listingDate(lb) ?? LAST)
                            );
                          case "foundNewest":
                            return (
                              (lb?._creationTime ?? -LAST) -
                              (la?._creationTime ?? -LAST)
                            );
                          case "score":
                          default:
                            return (
                              (matchScore(b, evaluations) ?? 0) -
                              (matchScore(a, evaluations) ?? 0)
                            );
                        }
                      }
                      const totalMatches = sortedMatches.length;
                      const totalPages = Math.max(
                        1,
                        Math.ceil(totalMatches / pageSize),
                      );
                      const validPage = Math.min(page, totalPages);
                      const startIndex = (validPage - 1) * pageSize;
                      const endIndex = Math.min(
                        startIndex + pageSize,
                        totalMatches,
                      );
                      const paginatedMatches = sortedMatches.slice(
                        startIndex,
                        endIndex,
                      );

                      return (
                        <>
                          {paginatedMatches.map((m) => {
                            const listing = matchedListing(m.listingId ?? "");
                            const isExpanded = expandedMatch === m._id;
                            const hasEvaluation =
                              evaluations[m._id] !== undefined
                                ? evaluations[m._id]
                                : m.evaluation;
                            const scoreDetail:
                              | EvaluationScoreDetail
                              | undefined =
                              scoreDetails[m._id] ??
                              (
                                m as Doc<"matching"> & {
                                  scoreDetail?: EvaluationScoreDetail;
                                }
                              ).scoreDetail;

                            // Extract score from DB score or from evaluation text string
                            const extractedScore =
                              m.score ??
                              (hasEvaluation
                                ? hasEvaluation.match(/評価[：:\s]*(\d+)/)?.[1]
                                  ? Number(
                                      hasEvaluation.match(
                                        /評価[：:\s]*(\d+)/,
                                      )[1],
                                    )
                                  : undefined
                                : undefined);

                            return (
                              <div
                                key={m._id}
                                className={`border rounded-2xl overflow-hidden transition-all duration-200 shadow-xs ${
                                  selectedForProposal.has(m._id)
                                    ? "border-emerald-300 bg-emerald-50/60 ring-2 ring-emerald-500/20"
                                    : "border-[var(--border-subtle)] bg-white hover:border-[var(--border-strong)] hover:shadow-sm"
                                }`}
                              >
                                {/* Header Row */}
                                <div
                                  className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 cursor-pointer select-none"
                                  onClick={() => toggleExpand(m._id)}
                                >
                                  <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                                    {/* Tick here, then 顧客へ物件を提案 opens with these
                                    already chosen. stopPropagation keeps the click
                                    from toggling the row's expand state. */}
                                    <input
                                      type="checkbox"
                                      checked={selectedForProposal.has(m._id)}
                                      onChange={() =>
                                        toggleProposalSelection(m._id)
                                      }
                                      onClick={(e) => e.stopPropagation()}
                                      className="w-4 h-4 accent-emerald-700 shrink-0 cursor-pointer"
                                      title="提案メールに含める"
                                      aria-label="提案に含める"
                                    />
                                    {/* ★ shortlist. Sends a SNAPSHOT of the listing,
                                    not just its id: `listings` rows are deleted
                                    with the last order that matched them, and a
                                    saved property must outlive that (see
                                    convex/savedListings.js). */}
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void toggleSaved({
                                          listingId: m.listingId,
                                          orderId: order._id,
                                          orderName: order.name,
                                          address: listing?.address,
                                          ward: listing?.ward,
                                          price: listing?.price,
                                          area: listing?.area,
                                          landSize: listing?.landSize,
                                          source: listing?.source,
                                          url: listing?.url,
                                          propertyType: listing?.propertyType,
                                          station: listing?.station,
                                          walkMinutes: listing?.walkMinutes,
                                          score: extractedScore,
                                          postedAt: listing?.postedAt,
                                          postedDateKind:
                                            listing?.postedDateKind,
                                        });
                                      }}
                                      className="shrink-0 p-0.5 rounded-md hover:bg-amber-50 transition-colors cursor-pointer"
                                      title={
                                        m.listingId && savedSet.has(m.listingId)
                                          ? "保存物件から外す"
                                          : "保存物件に追加（★）"
                                      }
                                      aria-label="保存物件に追加"
                                      aria-pressed={Boolean(
                                        m.listingId &&
                                        savedSet.has(m.listingId),
                                      )}
                                    >
                                      <Star
                                        className={`w-4 h-4 transition-colors ${
                                          m.listingId &&
                                          savedSet.has(m.listingId)
                                            ? "text-amber-500 fill-amber-400"
                                            : "text-slate-300 hover:text-amber-400"
                                        }`}
                                      />
                                    </button>
                                    <MapPin className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                                    <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                                      {listing?.address ||
                                        m.listingId?.slice(0, 8) ||
                                        "—"}
                                    </span>

                                    {/* Source Portal Tag */}
                                    {listing?.source === "email" ? (
                                      <span title={listing.emailFrom || "メールで届いた物件紹介"}>
                                        <Badge
                                          variant="amber"
                                          className="text-[10px] shrink-0"
                                        >
                                          メール
                                        </Badge>
                                      </span>
                                    ) : (
                                      listing?.source && (
                                      <Badge
                                        variant="brand"
                                        className="text-[10px] shrink-0"
                                      >
                                        {listing.source === "stepon"
                                          ? "住友不動産"
                                          : listing.source === "mitsui"
                                            ? "三井のリハウス"
                                            : listing.source === "tokyu"
                                              ? "東急リバブル"
                                              : listing.source === "nomu"
                                                ? "ノムコム"
                                                : listing.source === "nomu_pro"
                                                  ? "ノムコムプロ"
                                                  : listing.source === "mizuho"
                                                    ? "みずほ不動産"
                                                    : listing.source ===
                                                        "mitsubishi_ufj"
                                                      ? "三菱UFJ"
                                                      : listing.source ===
                                                          "odakyu"
                                                        ? "小田急"
                                                        : listing.source ===
                                                            "keio"
                                                          ? "京王"
                                                          : listing.source ===
                                                              "asahi"
                                                            ? "朝日住宅"
                                                            : listing.source ===
                                                                "haseko"
                                                              ? "長谷工"
                                                              : listing.source ===
                                                                  "daikyo"
                                                                ? "大京穴吹"
                                                                : listing.source ===
                                                                    "tokyotatemono"
                                                                  ? "東京建物"
                                                                  : listing.source ===
                                                                      "homes"
                                                                    ? "LIFULL HOME'S"
                                                                    : listing.source}
                                      </Badge>
                                      )
                                    )}

                                    {/* Property Type Tag */}
                                    {listing?.propertyType && (
                                      <Badge
                                        variant="neutral"
                                        className="text-[10px] shrink-0"
                                      >
                                        {listing.propertyType}
                                      </Badge>
                                    )}

                                    {/* The portal's own 新着 badge. Kept separate from
                                    掲載日: 東急リバブル・みずほ・東京建物 show this
                                    badge but never publish a date. */}
                                    {listing?.isNew && (
                                      <Badge className="text-[10px] shrink-0 bg-rose-100 text-rose-900 border border-rose-200 font-black">
                                        新着
                                      </Badge>
                                    )}

                                    {/* Recent match badge (found in last 24h) */}
                                    {m._creationTime &&
                                      Date.now() - m._creationTime <=
                                        24 * 60 * 60 * 1000 && (
                                        <Badge className="text-[10px] shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white border-0 font-extrabold shadow-2xs gap-1 py-0.5 px-2">
                                          <Sparkles className="w-2.5 h-2.5 animate-pulse" />
                                          本日の新着
                                        </Badge>
                                      )}

                                    {/* Prominent Score Badge on Item Header BEFORE Expanding */}
                                    {extractedScore !== undefined && (
                                      <span
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const current = extractedScore;
                                          const next =
                                            current >= 100
                                              ? 0
                                              : (current || 0) + 10;
                                          saveScore({
                                            matchId: m._id,
                                            score: next,
                                          });
                                        }}
                                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-black border shrink-0 transition-all ${
                                          extractedScore >= 80
                                            ? "bg-emerald-100 text-emerald-900 border-emerald-300 shadow-xs"
                                            : extractedScore >= 60
                                              ? "bg-green-100 text-green-900 border-green-300 shadow-xs"
                                              : extractedScore >= 40
                                                ? "bg-amber-100 text-amber-900 border-amber-300 shadow-xs"
                                                : "bg-red-100 text-red-900 border-red-300 shadow-xs"
                                        }`}
                                        title="クリックでスコア変更"
                                      >
                                        評価 {extractedScore}点
                                      </span>
                                    )}

                                    {/* Evaluation Status Badge if evaluated but no score */}
                                    {hasEvaluation &&
                                      extractedScore === undefined && (
                                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-200 flex items-center gap-1 shrink-0">
                                          評価済み
                                        </span>
                                      )}

                                    {evaluatingId === m._id && (
                                      <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1 shrink-0 animate-pulse">
                                        <Loader2 className="w-3 h-3 animate-spin text-emerald-600" />
                                        評価中...
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-4 shrink-0 text-slate-700">
                                    {listing?.price && (
                                      <div className="flex flex-col items-end">
                                        <div className="flex items-center gap-1.5">
                                          {(listing.priceDropped || (listing.previousPrice && listing.price < listing.previousPrice)) && (
                                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
                                              <TrendingDown className="w-3 h-3 text-rose-500" />
                                              値下げ{listing.priceDropPct ? ` -${listing.priceDropPct}%` : ""}
                                            </span>
                                          )}
                                          <span className="text-base font-black text-slate-900 font-data">
                                            {listing.price.toLocaleString()}
                                            <span className="text-xs font-normal ml-0.5 text-slate-600">
                                              万円
                                            </span>
                                          </span>
                                        </div>
                                        {listing.previousPrice && listing.price < listing.previousPrice && (
                                          <span className="text-[11px] text-slate-400 line-through font-data">
                                            {listing.previousPrice.toLocaleString()} 万円
                                          </span>
                                        )}
                                      </div>
                                    )}

                                    {listing?.landSize && (
                                      <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                                        <Ruler className="w-3.5 h-3.5 text-slate-400" />
                                        {listing.landSize}㎡
                                      </span>
                                    )}

                                    {listing?.walkMinutes !== undefined && (
                                      <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                                        <Train className="w-3.5 h-3.5 text-slate-400" />
                                        徒歩{listing.walkMinutes}分
                                      </span>
                                    )}

                                    {/* No 取得日 on the collapsed row — it competed with
                                    price / area / walk time for space and is the
                                    least useful of them at a glance. Both dates
                                    (掲載日 and 取得日時) are in the expanded details. */}

                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4 text-slate-400" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-slate-400" />
                                    )}
                                  </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && listing && (
                                  <div className="p-5 border-t border-slate-200 bg-white space-y-4 text-sm animate-in fade-in duration-200">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          所在地
                                        </div>
                                        <div className="text-sm font-semibold text-slate-800 mt-0.5">
                                          {listing.address || "—"}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          価格
                                        </div>
                                        <div className="text-base font-extrabold text-emerald-700 font-data mt-0.5">
                                          {listing.price
                                            ? `${listing.price.toLocaleString()} 万円`
                                            : "—"}
                                        </div>
                                        {(listing.priceDropped || (listing.previousPrice && listing.price < listing.previousPrice)) && (
                                          <div className="text-xs font-bold text-rose-600 flex items-center gap-1 mt-0.5">
                                            <TrendingDown className="w-3.5 h-3.5" />
                                            <span>
                                              前回: {listing.previousPrice?.toLocaleString()} 万円
                                              {listing.priceDropPct ? ` (${listing.priceDropPct}% DOWN)` : ""}
                                            </span>
                                          </div>
                                        )}
                                      </div>
                                      {/* 土地面積 and 専有/建物面積 are different numbers
                                      and both are filterable, so showing whichever
                                      happened to be set under one "面積" label hid
                                      which of the two the buyer was looking at. */}
                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          面積
                                        </div>
                                        <div className="text-sm font-semibold text-slate-800 mt-0.5 font-data space-y-0.5">
                                          {listing.landSize == null &&
                                          listing.area == null ? (
                                            <div>—</div>
                                          ) : (
                                            <>
                                              {listing.landSize != null && (
                                                <div>
                                                  土地 {listing.landSize} ㎡
                                                </div>
                                              )}
                                              {listing.area != null && (
                                                <div>
                                                  専有/延床 {listing.area} ㎡
                                                </div>
                                              )}
                                            </>
                                          )}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          最寄駅アクセス
                                        </div>
                                        <div className="text-sm font-semibold text-slate-800 mt-0.5">
                                          {listing.station || "—"}{" "}
                                          {listing.walkMinutes !== undefined
                                            ? `(徒歩${listing.walkMinutes}分)`
                                            : ""}
                                        </div>
                                      </div>

                                      {/* Three separate facts that used to be muddled
                                      into one: when the PORTAL posted it, when OUR
                                      search found it, and who ran that search.
                                      Often weeks apart, so never derived from each
                                      other. */}
                                      {(() => {
                                        const d = describePostedDate(listing);
                                        return (
                                          <div>
                                            <div className="text-xs font-bold text-slate-400">
                                              {d.label}
                                              <span
                                                className="ml-1 cursor-help text-slate-300"
                                                title={d.note}
                                              >
                                                ⓘ
                                              </span>
                                            </div>
                                            <div className="text-sm font-semibold text-slate-800 mt-0.5">
                                              {d.value ? (
                                                formatJaDate(d.value)
                                              ) : (
                                                <span className="text-slate-400 font-medium">
                                                  {d.missingReason ===
                                                  "unpublished"
                                                    ? "掲載元が非公開"
                                                    : "未取得（次回の検索で取得）"}
                                                </span>
                                              )}
                                            </div>
                                          </div>
                                        );
                                      })()}

                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          最終検索日時
                                        </div>
                                        <div className="text-sm font-semibold text-slate-800 mt-0.5">
                                          {listing._creationTime
                                            ? formatJaDateTime(
                                                listing._creationTime,
                                              )
                                            : "—"}
                                        </div>
                                      </div>

                                      {/* Attribution lives on the ORDER (the search is
                                      run per order, not per listing), which is why
                                      it reads from `order` here. */}
                                      <div>
                                        <div className="text-xs font-bold text-slate-400">
                                          検索の実行者
                                        </div>
                                        <div className="text-sm font-semibold text-slate-800 mt-0.5">
                                          {order.lastScrapeBy ? (
                                            isAutomaticTrigger(
                                              order.lastScrapeBy,
                                            ) ? (
                                              <span className="inline-flex items-center gap-1">
                                                <Bot className="w-3.5 h-3.5 text-slate-400" />
                                                {order.lastScrapeBy}
                                              </span>
                                            ) : (
                                              order.lastScrapeBy
                                            )
                                          ) : (
                                            <span
                                              className="text-slate-400 font-medium cursor-help"
                                              title="この物件が取得された時点では実行者を記録していませんでした。次回の検索から記録されます。"
                                            >
                                              記録なし
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Listing Specs (Structure, Floor, EV, Units, Road) */}
                                    {(listing.floor != null ||
                                      listing.elevators != null ||
                                      listing.structure ||
                                      listing.totalUnits != null ||
                                      listing.roadWidth != null ||
                                      listing.frontage != null ||
                                      listing.buildYear != null ||
                                      listing.buildingCoverageRatio != null ||
                                      listing.floorAreaRatio != null) && (
                                      <div className="flex flex-wrap gap-2 pt-1 text-xs text-slate-700">
                                        {listing.floor != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">階数:</span>
                                            {listing.floor < 0 ? `地下${-listing.floor}階` : `${listing.floor}階`}
                                          </span>
                                        )}
                                        {listing.elevators != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">EV:</span>
                                            {listing.elevators === 0 ? "なし" : `${listing.elevators}基`}
                                          </span>
                                        )}
                                        {(listing.structure || listing.structureType) && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">構造:</span>
                                            {listing.structure || listing.structureType}
                                          </span>
                                        )}
                                        {listing.totalUnits != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">総戸数:</span>
                                            {listing.totalUnits}戸
                                          </span>
                                        )}
                                        {listing.buildYear != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">築年:</span>
                                            {listing.buildYear}年 ({new Date().getFullYear() - listing.buildYear}年)
                                          </span>
                                        )}
                                        {listing.roadWidth != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">前面道路:</span>
                                            幅員{listing.roadWidth}m
                                          </span>
                                        )}
                                        {listing.frontage != null && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">間口:</span>
                                            {listing.frontage}m
                                          </span>
                                        )}
                                        {(listing.buildingCoverageRatio != null || listing.floorAreaRatio != null) && (
                                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 font-medium">
                                            <span className="text-slate-400 font-bold">建蔽/容積:</span>
                                            {listing.buildingCoverageRatio ?? "—"}% / {listing.floorAreaRatio ?? "—"}%
                                          </span>
                                        )}
                                      </div>
                                    )}

                                    {/* External Link & Google Maps */}
                                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                      {/* Email listings' `url` is a synthesized
                                          `email:{provider}:{id}:{i}` key used only
                                          for de-dup (see mailIngestData.js) — not a
                                          real page, so no link for those. */}
                                      {listing.url && listing.source !== "email" ? (
                                        <a
                                          href={listing.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-800 font-bold text-xs hover:bg-emerald-100 transition-colors"
                                        >
                                          ポータル掲載ページを開く (
                                          {listing.source}
                                          )
                                          <ExternalLink className="w-3.5 h-3.5" />
                                        </a>
                                      ) : null}

                                      {listing.address && GMAPS_KEY && (
                                        <a
                                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address)}`}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 transition-colors"
                                        >
                                          Google Mapsで位置確認
                                          <ArrowUpRight className="w-3.5 h-3.5" />
                                        </a>
                                      )}
                                    </div>

                                    {/* Email Source Details & PDF Attachments */}
                                    {(listing.source === "email" ||
                                      listing.url?.startsWith("email:") ||
                                      Boolean(listing.emailFrom)) && (
                                      <EmailListingDetails
                                        listing={listing}
                                        handleOpenAttachment={handleOpenAttachment}
                                        openingAttachmentId={openingAttachmentId}
                                      />
                                    )}

                                    {/* Evaluation Section */}
                                    <div className="border-t border-slate-100 pt-3">
                                      {hasEvaluation ? (
                                        <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-2">
                                          <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2 text-emerald-900 font-bold text-sm">
                                              <FileText className="w-4 h-4 text-emerald-700" />
                                              物件評価レポート
                                            </div>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 text-xs font-bold text-emerald-800 hover:bg-emerald-100"
                                              onClick={() =>
                                                handleEvaluate(
                                                  m._id,
                                                  listing,
                                                  order,
                                                )
                                              }
                                              disabled={evaluatingId === m._id}
                                            >
                                              {evaluatingId === m._id
                                                ? "評価中..."
                                                : "再評価"}
                                            </Button>
                                          </div>
                                          <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed font-sans">
                                            {hasEvaluation}
                                          </div>

                                          {scoreDetail?.comparables &&
                                            scoreDetail.comparables.length >
                                              0 && (
                                              <div className="mt-2 rounded-lg border border-emerald-100 bg-white/70 p-3">
                                                <div className="text-[11px] font-bold text-emerald-900 mb-1.5 flex flex-wrap items-baseline gap-x-2">
                                                  <span>類似取引事例（国交省データ・面積が近い順）</span>
                                                  {scoreDetail.marketAvgPrice != null && (
                                                    <span className="font-normal text-slate-500">
                                                      平均 {scoreDetail.marketAvgPrice.toLocaleString()}万円
                                                    </span>
                                                  )}
                                                  {scoreDetail.marketAvgPricePerSqm != null && (
                                                    <span className="font-semibold text-emerald-700">
                                                      相場単価: {scoreDetail.marketAvgPricePerSqm.toLocaleString()}万円/㎡
                                                    </span>
                                                  )}
                                                  {scoreDetail.listingPricePerSqm != null && (
                                                    <span className="font-normal text-slate-600">
                                                      （当物件: {scoreDetail.listingPricePerSqm}万円/㎡）
                                                    </span>
                                                  )}
                                                </div>
                                                <div className="space-y-1">
                                                  {scoreDetail.comparables.map(
                                                    (comp, i) => (
                                                      <div
                                                        key={i}
                                                        className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-600"
                                                      >
                                                        <span className="font-semibold text-slate-800">
                                                          {comp.price.toLocaleString()}
                                                          万円
                                                        </span>
                                                        <span>
                                                          {comp.area != null
                                                            ? `${comp.area}㎡`
                                                            : "面積不明"}
                                                          {comp.pricePerSqm != null && (
                                                            <span className="ml-1 text-emerald-700 text-[10px]">
                                                              ({comp.pricePerSqm}万円/㎡)
                                                            </span>
                                                          )}
                                                        </span>
                                                        <span>
                                                          {comp.district || ""}
                                                        </span>
                                                        <span>
                                                          {comp.station
                                                            ? `${comp.station}駅${comp.walkMinutes ? ` 徒歩${comp.walkMinutes}分` : ""}`
                                                            : ""}
                                                        </span>
                                                        <span>
                                                          築
                                                          {comp.buildYear ||
                                                            "不明"}
                                                        </span>
                                                        <span className="text-slate-400">
                                                          {comp.period || ""}
                                                        </span>
                                                      </div>
                                                    ),
                                                  )}
                                                </div>
                                              </div>
                                            )}

                                          {scoreDetail?.dataWarnings &&
                                            scoreDetail.dataWarnings.length >
                                              0 && (
                                              <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 space-y-0.5">
                                                {scoreDetail.dataWarnings.map(
                                                  (w, i) => (
                                                    <div key={i}>⚠ {w}</div>
                                                  ),
                                                )}
                                              </div>
                                            )}
                                        </div>
                                      ) : (
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="w-full h-10 text-xs font-bold gap-2 border-emerald-200 text-emerald-800 hover:bg-emerald-50 rounded-xl"
                                          onClick={() =>
                                            handleEvaluate(m._id, listing)
                                          }
                                          disabled={evaluatingId === m._id}
                                        >
                                          {evaluatingId === m._id ? (
                                            <>
                                              <Loader2 className="w-4 h-4 animate-spin text-emerald-700" />
                                              評価実行中...
                                            </>
                                          ) : (
                                            <>
                                              <FileText className="w-4 h-4 text-emerald-700" />
                                              物件の適正評価と強み・懸念点を分析
                                            </>
                                          )}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {/* Pagination & Display Controls */}
                          {totalMatches > 0 && (
                            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-200 mt-4">
                              <div className="text-xs font-semibold text-slate-500">
                                全{" "}
                                <span className="font-extrabold text-slate-900">
                                  {totalMatches}
                                </span>{" "}
                                件中{" "}
                                <span className="font-extrabold text-slate-900">
                                  {startIndex + 1}
                                </span>{" "}
                                〜{" "}
                                <span className="font-extrabold text-slate-900">
                                  {endIndex}
                                </span>{" "}
                                件目を表示
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {/* Page Size Selector */}
                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                                  {[10, 25, 50, 9999].map((size) => (
                                    <button
                                      key={size}
                                      type="button"
                                      onClick={() => {
                                        setShowLimit((prev) => ({
                                          ...prev,
                                          [order._id]: size,
                                        }));
                                        setCurrentPage((prev) => ({
                                          ...prev,
                                          [order._id]: 1,
                                        }));
                                      }}
                                      className={`px-2.5 py-1 rounded-lg transition-all ${
                                        pageSize === size
                                          ? "bg-white text-emerald-800 shadow-xs font-black"
                                          : "text-slate-600 hover:text-slate-900"
                                      }`}
                                    >
                                      {size === 9999 ? "全件" : `${size}件`}
                                    </button>
                                  ))}
                                </div>

                                {/* Page Navigation Buttons */}
                                {totalPages > 1 && (
                                  <div className="flex items-center gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={validPage <= 1}
                                      onClick={() =>
                                        setCurrentPage((prev) => ({
                                          ...prev,
                                          [order._id]: validPage - 1,
                                        }))
                                      }
                                      className="h-8 px-2.5 text-xs font-bold border-slate-200 rounded-lg text-slate-700"
                                    >
                                      <ChevronLeft className="w-4 h-4 mr-0.5" />
                                      前へ
                                    </Button>

                                    <div className="flex items-center gap-1 px-1">
                                      {Array.from(
                                        { length: totalPages },
                                        (_, i) => i + 1,
                                      ).map((p) => {
                                        if (
                                          totalPages <= 7 ||
                                          p === 1 ||
                                          p === totalPages ||
                                          Math.abs(p - validPage) <= 1
                                        ) {
                                          return (
                                            <button
                                              key={p}
                                              type="button"
                                              onClick={() =>
                                                setCurrentPage((prev) => ({
                                                  ...prev,
                                                  [order._id]: p,
                                                }))
                                              }
                                              className={`w-7 h-7 rounded-lg text-xs font-bold transition-all ${
                                                validPage === p
                                                  ? "bg-emerald-700 text-white shadow-xs font-extrabold"
                                                  : "bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200"
                                              }`}
                                            >
                                              {p}
                                            </button>
                                          );
                                        }
                                        if (
                                          (p === 2 && validPage > 3) ||
                                          (p === totalPages - 1 &&
                                            validPage < totalPages - 2)
                                        ) {
                                          return (
                                            <span
                                              key={p}
                                              className="text-slate-400 text-xs px-0.5"
                                            >
                                              …
                                            </span>
                                          );
                                        }
                                        return null;
                                      })}
                                    </div>

                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={validPage >= totalPages}
                                      onClick={() =>
                                        setCurrentPage((prev) => ({
                                          ...prev,
                                          [order._id]: validPage + 1,
                                        }))
                                      }
                                      className="h-8 px-2.5 text-xs font-bold border-slate-200 rounded-lg text-slate-700"
                                    >
                                      次へ
                                      <ChevronRight className="w-4 h-4 ml-0.5" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                      </>
                    ) : (
                    <div className="py-8 text-center text-xs text-[var(--text-muted)] font-medium">
                      このオーダーにマッチする物件はまだありません。「手動検索」を実行して最新物件を取得してください。
                    </div>
                  )}
                  </CardContent>
                )}

                {/* Bottom accordion toggle */}
                <button
                  type="button"
                  onClick={() => toggleOrderExpanded(order._id)}
                  className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)] border-t border-[var(--border-subtle)] transition-colors cursor-pointer select-none"
                >
                  {isCardExpanded ? (
                    <>
                      <ChevronUp className="w-4 h-4" />
                      物件一覧を閉じる
                    </>
                  ) : (
                    <>
                      <ChevronDown className="w-4 h-4" />
                      物件一覧を表示 ({matchCount}件) — クリックして展開
                    </>
                  )}
                </button>
              </Card>
            );
          })
        )}
      </div>
      {proposalOrder && (
        <ProposalModal
          // Flattened here rather than inside the modal, so 保存物件 can feed the
          // same modal from rows that are not matches at all.
          items={(orderMatches(proposalOrder._id) || []).map((m) => {
            const listing = matchedListing(m.listingId ?? "");
            return {
              id: m._id,
              listingId: m.listingId,
              address: listing?.address,
              ward: listing?.ward,
              price: listing?.price,
              size: listing?.landSize ?? listing?.area,
              station: listing?.station,
              walkMinutes: listing?.walkMinutes,
              url: listing?.url,
              source: listing?.source,
              propertyType: listing?.propertyType,
              score: matchScore(m, evaluations),
              evaluation: m.evaluation || evaluations[m._id],
            };
          })}
          initialSelectedIds={selectedForProposal}
          contextName={proposalOrder.name}
          orderId={proposalOrder._id}
          defaultCustomerId={proposalOrder.customerId}
          onClose={() => setProposalOrder(null)}
        />
      )}

      {showMailRules && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-ambient border border-[var(--border-subtle)] w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4" />
                  メール取り込み設定
                </h3>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  どのメールを物件情報として読み取るかを決めます。1行に1つ入力してください。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMailRules(false)}
                className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto p-5 space-y-4">
              {[
                {
                  key: "requiredKeywords" as const,
                  label: "必須ワード",
                  hint: "件名か本文にこのいずれかを含むメールだけを読み取ります。空欄ならすべて読み取ります。",
                  placeholder: "物件\n物件概要\n売買価格",
                },
                {
                  key: "blockedKeywords" as const,
                  label: "除外ワード",
                  hint: "このいずれかを含むメールは読み取りません。",
                  placeholder: "メルマガ\nセミナー\nPremium deal",
                },
                {
                  key: "allowedSenders" as const,
                  label: "許可する送信者",
                  hint: "入力すると、この送信者からのメールだけを読み取ります。@以下だけでも指定できます。",
                  placeholder: "@baseltd.co.jp\ninagaki@xialead.co.jp",
                },
                {
                  key: "blockedSenders" as const,
                  label: "除外する送信者",
                  hint: "この送信者からのメールは読み取りません。",
                  placeholder: "@marketing.going.com\nnoreply@",
                },
              ].map((f) => (
                <div key={f.key}>
                  <Label className="text-xs font-bold text-[var(--text-primary)]">
                    {f.label}
                  </Label>
                  <p className="text-[11px] text-[var(--text-muted)] mt-0.5 mb-1.5">{f.hint}</p>
                  <textarea
                    rows={4}
                    value={mailRules[f.key]}
                    placeholder={f.placeholder}
                    onChange={(e) =>
                      setMailRules((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    className="w-full text-xs rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-2 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/30"
                  />
                </div>
              ))}

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={mailRules.requireAttachment}
                  onChange={(e) =>
                    setMailRules((prev) => ({ ...prev, requireAttachment: e.target.checked }))
                  }
                  className="mt-0.5 w-4 h-4 accent-[var(--brand)]"
                />
                <span>
                  <span className="block text-xs font-bold text-[var(--text-primary)]">
                    添付ファイルのあるメールだけを読み取る
                  </span>
                  <span className="block text-[11px] text-[var(--text-muted)]">
                    マイソクを必ず添付する会社だけを対象にしたい場合に使います。本文だけで物件を紹介するメールは除外されます。
                  </span>
                </span>
              </label>
            </div>

            <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between gap-3">
              <p className="text-[11px] text-[var(--text-muted)]">
                設定の効果は「同期メールを確認」で確認できます。
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowMailRules(false)}
                  className="h-8 px-3 text-xs font-bold rounded-lg"
                >
                  キャンセル
                </Button>
                <Button
                  size="sm"
                  disabled={savingMailRules}
                  onClick={() => void handleSaveMailRules()}
                  className="h-8 px-3 text-xs font-bold rounded-lg gap-1.5"
                >
                  {savingMailRules && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TEMPORARY: mail sync inspector. Shows each recent message, what it
          carried, and what the rule-based parser made of it. */}
      {inspected && (() => {
        const displayedMails = filterMatchedOnly
          ? inspected.filter((m) => !m.filtered && !m.error)
          : inspected;
        const matchedCount = inspected.filter((m) => !m.filtered && !m.error).length;

        return (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-ambient border border-[var(--border-subtle)] w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
              <div className="p-5 border-b border-[var(--border-subtle)] bg-[var(--bg-page-subtle)] flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    同期メールの内容（{displayedMails.length}件）
                  </h3>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    過去3ヶ月の受信メールから取り込み条件に合致したメールを表示
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleInspectMail(true)}
                    disabled={inspecting}
                    title="各メールをAIで実際に解析し、取り込まれる物件情報を表示します（同期と同じ処理・保存はしません）"
                    className="text-xs font-bold px-2.5 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-white shadow-xs hover:border-[var(--brand)] disabled:opacity-50"
                  >
                    {inspecting ? "解析中…" : "AIで抽出を確認"}
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)] font-semibold cursor-pointer select-none bg-white px-2.5 py-1.5 rounded-xl border border-[var(--border-subtle)] shadow-xs hover:border-[var(--brand)]">
                    <input
                      type="checkbox"
                      checked={filterMatchedOnly}
                      onChange={(e) => setFilterMatchedOnly(e.target.checked)}
                      className="rounded border-gray-300 text-brand focus:ring-brand"
                    />
                    設定に一致したメールのみ ({matchedCount}/{inspected.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => setInspected(null)}
                    className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-lg hover:bg-slate-100"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto p-4 space-y-2 flex-1">
                {displayedMails.length === 0 ? (
                  <div className="text-center py-12 px-4">
                    <Mail className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3 opacity-40" />
                    <p className="text-sm font-bold text-[var(--text-secondary)]">
                      {filterMatchedOnly
                        ? "取り込み設定に合致するメールはありませんでした"
                        : "表示できるメールがありません"}
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">
                      {filterMatchedOnly
                        ? "「取り込み設定」で設定した必須キーワードや許可送信者などの条件をご確認ください。右上のチェックを外すと除外されたメールも確認できます。"
                        : "受信トレイにメールが見つかりませんでした。"}
                    </p>
                  </div>
                ) : (
                  displayedMails.map((m) => {
                    const open = openMailId === m.id;
                    const count = m.listings?.length ?? 0;
                    return (
                      <div
                        key={m.id}
                        className="border border-[var(--border-subtle)] rounded-2xl overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => setOpenMailId(open ? null : m.id)}
                          className="w-full text-left px-4 py-3 hover:bg-[var(--bg-page-subtle)] flex items-start gap-3"
                        >
                          <span
                            className={`mt-0.5 shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-bold ${
                              m.error
                                ? "bg-red-100 text-red-800"
                                : m.filtered
                                  ? "bg-violet-100 text-violet-900"
                                  : count > 0
                                    ? "bg-emerald-100 text-emerald-900"
                                    : m.needsLlm
                                      ? "bg-amber-100 text-amber-900"
                                      : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {m.error
                              ? "エラー"
                              : m.filtered
                                ? "設定で除外"
                                : count > 0
                                  ? `物件${count}件`
                                  : m.needsLlm
                                    ? "AI判定へ"
                                    : "対象外"}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-[var(--text-primary)] truncate">
                              {m.subject || "(件名なし)"}
                            </span>
                            <span className="block text-[11px] text-[var(--text-muted)] truncate">
                              {m.from}
                              {m.receivedAt ? ` ・ ${formatJaDateTimeShort(m.receivedAt)}` : ""}
                              {(m.attachments?.length ?? 0) > 0
                                ? ` ・ 添付${m.attachments?.length}件`
                                : ""}
                            </span>
                          </span>
                          {open ? (
                            <ChevronUp className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                          ) : (
                            <ChevronDown className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
                          )}
                        </button>

                        {open && (
                          <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-subtle)] pt-3">
                            {m.error && (
                              <p className="text-xs font-semibold text-red-700">{m.error}</p>
                            )}

                            <p className="text-[11px] text-[var(--text-muted)]">
                              判定: {m.reason}
                              {/* Once the AI pass has run, "AIでの抽出が必要" is
                                  stale advice — say what actually read it. */}
                              {m.engine
                                ? `（抽出: ${
                                    m.engine === "stored"
                                      ? "取込済み（保存されたデータ）"
                                      : m.engine === "rules"
                                        ? "ルール解析"
                                        : m.engine === "gemini"
                                          ? "AI・添付PDFを直接読取"
                                          : m.engine === "groq"
                                            ? "AI・本文/PDFテキスト"
                                            : "物件は見つかりませんでした"
                                  }）`
                                : m.needsLlm
                                  ? "（AIでの抽出が必要）"
                                  : ""}
                            </p>

                            {count > 0 && (
                              <div className="space-y-1.5">
                                {m.listings?.map((l, i) => (
                                  <div
                                    key={i}
                                    className="text-[11px] bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-emerald-950 break-all"
                                  >
                                    {Object.entries(l)
                                      .filter(([, v]) => v !== null && v !== "")
                                      .map(([k, v]) => `${k}: ${String(v)}`)
                                      .join(" ／ ")}
                                  </div>
                                ))}
                              </div>
                            )}

                            {(m.attachments?.length ?? 0) > 0 && (
                              <div className="text-[11px] text-[var(--text-secondary)]">
                                <span className="font-bold flex items-center gap-1 mb-1.5 text-[var(--text-primary)]">
                                  <FileText className="w-3.5 h-3.5 text-[var(--brand)]" />
                                  添付ファイル（クリックしてPDFを開く）
                                </span>
                                <div className="flex flex-wrap gap-2">
                                  {m.attachments?.map((a, i) => {
                                    const isPdf =
                                      a.mimeType === "application/pdf" ||
                                      a.filename?.toLowerCase().endsWith(".pdf");
                                    const isOpening = openingAttachmentId === a.id;
                                    return (
                                      <button
                                        key={i}
                                        type="button"
                                        disabled={isOpening || !a.id}
                                        onClick={() => void handleOpenAttachment(m.provider, m.id, a)}
                                        className="group flex items-center gap-2 px-3 py-1.5 rounded-xl border border-[var(--border-subtle)] bg-white hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] transition-colors text-left shadow-2xs"
                                        title={a.id ? "クリックして別タブで開く" : "添付ファイルIDがありません"}
                                      >
                                        {isOpening ? (
                                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--brand)] shrink-0" />
                                        ) : isPdf ? (
                                          <FileText className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                        ) : (
                                          <FileText className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
                                        )}
                                        <div className="min-w-0 max-w-[260px]">
                                          <span className="block font-bold text-[11px] text-[var(--text-primary)] group-hover:text-[var(--brand)] truncate">
                                            {a.filename || "(名前なし)"}
                                          </span>
                                          <span className="block text-[10px] text-[var(--text-muted)]">
                                            {a.size ? `${Math.round(a.size / 1024)}KB` : a.mimeType}
                                          </span>
                                        </div>
                                        <ExternalLink className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--brand)] shrink-0 ml-1 opacity-70 group-hover:opacity-100" />
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            <div>
                              <span className="text-[11px] font-bold text-[var(--text-secondary)]">
                                本文
                              </span>
                              <pre className="mt-1 text-[11px] leading-relaxed whitespace-pre-wrap break-all bg-[var(--bg-page-subtle)] rounded-xl p-3 max-h-72 overflow-y-auto text-[var(--text-secondary)]">
                                {m.bodyText || "(本文なし)"}
                              </pre>
                            </div>

                            {m.pdfTexts?.map((t, i) => (
                              <div key={i}>
                                <span className="text-[11px] font-bold text-[var(--text-secondary)]">
                                  PDF {i + 1} の抽出テキスト
                                </span>
                                <pre className="mt-1 text-[11px] leading-relaxed whitespace-pre-wrap break-all bg-[var(--bg-page-subtle)] rounded-xl p-3 max-h-72 overflow-y-auto text-[var(--text-secondary)]">
                                  {t || "(テキストを抽出できませんでした)"}
                                </pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
