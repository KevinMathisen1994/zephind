import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
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
import { TOKYO_WARDS, TOKYO_CITIES, wardLabelToCode } from "../lib/tokyoWards";
import {
  RefreshCw,
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
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ProposalModal } from "../components/ProposalModal";
import type { Doc, Id } from "../../convex/_generated/dataModel";

const GMAPS_KEY = import.meta.env
  .VITE_NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string;

// Mirrors the comp shape built in convex/evaluate.js (MLIT XIT001 fields,
// normalized). Kept loose (`scoreDetail` is stored as `v.any()`) since it's
// diagnostic data, not something the app branches on.
type ComparableTrade = {
  price: number;
  area?: number | null;
  district?: string;
  station?: string;
  walkMinutes?: string;
  buildYear?: string;
  period?: string;
};

type EvaluationScoreDetail = {
  marketAvgPrice?: number | null;
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
  "13101", "13102", "13103", "13104", "13105", "13106", "13107", "13108",
  "13109", "13110", "13111", "13112", "13113", "13114", "13115", "13116",
  "13117", "13118", "13119", "13120", "13121", "13122", "13123",
];

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
    wards:
      strs("wards") ??
      (order.ward ? [order.ward] : undefined),
    priceMin: num("priceMin"),
    priceMax: num("priceMax"),
    areaMin: num("areaMin"),
    areaMax: num("areaMax"),
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
    excludeFirstFloor: (order.excludeFirstFloor ??
      nested.excludeFirstFloor) as boolean | undefined,
    maxFloor: num("maxFloor"),
    minElevators: num("minElevators"),
    minTotalUnits: num("minTotalUnits"),
  };
}

export default function OrdersPage() {
  const navigate = useNavigate();
  const orders = useQuery(api.orders.list);
  const customers = useQuery(api.customers.list);
  const createOrder = useMutation(api.orders.create);
  const deleteOrder = useMutation(api.orders.remove);
  const saveScore = useMutation(api.matching.saveScore);
  const updateOrder = useMutation(api.orders.update);
  const matches = useQuery(api.matching.list);

  const matchListingIds = useMemo(() => {
    if (!matches) return [];
    return Array.from(
      new Set(matches.map((m) => m.listingId).filter((id): id is string => Boolean(id)))
    );
  }, [matches]);

  const fetchedListings = useQuery(
    api.listings.getByIds,
    matchListingIds.length > 0 ? { ids: matchListingIds } : "skip"
  );

  const listings = useMemo(() => {
    if (!matches) return undefined;
    if (matchListingIds.length === 0) return [];
    return fetchedListings;
  }, [matches, matchListingIds.length, fetchedListings]);
  const evaluateListing = useAction(api.evaluate.evaluateListing);
  // Scraping no longer happens in the browser — see convex/scrapeTrigger.js.
  const triggerScrape = useAction(api.scrapeTrigger.triggerScrape);
  const getRecentRuns = useAction(api.scrapeTrigger.getRecentRuns);
  const cancelScrape = useAction(api.scrapeTrigger.cancelScrape);
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);

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
    activeRun != null && o.scrapeRunId != null && o.scrapeRunId === activeRun.id;

  const ordersRef = useRef<typeof orders>(undefined);
  ordersRef.current = orders;
  const [activeRun, setActiveRun] = useState<{ id: number; status: string; html_url: string; created_at: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = (await getRecentRuns({})) as { runs?: any[]; error?: string } | undefined;
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
            if (o.scrapingStatus === "dispatched" || o.scrapeRunId != null) {
              void updateOrder({ id: o._id, scrapingStatus: "completed" }).catch(
                () => {},
              );
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
  const [scrapeSource, setScrapeSource] = useState<Record<string, string>>({});
  const [activeScrapeSites, setActiveScrapeSites] = useState<Record<string, string>>({});

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
  const [evalProgress, setEvalProgress] = useState<
    Record<string, { current: number; total: number }>
  >({});
  const [orderStatus, setOrderStatus] = useState<string>("pending");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [proposalOrder, setProposalOrder] = useState<Doc<"orders"> | null>(null);

  // Per-order banner explaining that a dispatch was accepted (or why it wasn't).
  // The run itself happens on GitHub Actions, so there is nothing here to poll;
  // rows arrive through the reactive `matches`/`listings` queries.
  const [scrapeNotice, setScrapeNotice] = useState<
    Record<string, { kind: "ok" | "error"; text: string }>
  >({});



  const toggleExpand = (id: string) => {
    setExpandedMatch(expandedMatch === id ? null : id);
  };

  const handleEvaluate = async (matchId: string, listing: Doc<"listings">, order?: Doc<"orders">) => {
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
    await deleteOrder({ id });
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
  const [pendingAutoEvalOrderId, setPendingAutoEvalOrderId] = useState<string | null>(null);
  const autoEvalFired = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!pendingAutoEvalOrderId || !matches || !listings || !orders) return;
    if (scrapingOrderId === pendingAutoEvalOrderId) return; // scrape still running
    if (evaluatingOrderId) return; // another evaluation in flight

    const orderId = pendingAutoEvalOrderId;
    const pending = matches.filter((m) => {
      if (m.orderId !== orderId) return false;
      const listing = listings.find((l) => l._id === m.listingId);
      return listing && !m.evaluation && !evaluations[m._id];
    });
    if (pending.length === 0) return; // matches not propagated yet — wait for the next update

    const key = `${orderId}:${pending.length}`;
    if (autoEvalFired.current.has(key)) return;
    autoEvalFired.current.add(key);

    const order = orders.find((o) => o._id === orderId);
    setPendingAutoEvalOrderId(null);
    if (order) void handleBatchEvaluate(order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoEvalOrderId, matches, listings, orders, scrapingOrderId, evaluatingOrderId]);

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
        await Promise.all(
          chunk.map(async (m) => {
            const listing = listings?.find((l) => l._id === m.listingId);
            if (!listing) return;
            try {
              const result = await evaluateListing({
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
                orderCriteria,
              });
              if (result?.evaluation) {
                setEvaluations((prev) => ({
                  ...prev,
                  [m._id]: result.evaluation,
                }));
              }
              if (result?.scoreDetail) {
                setScoreDetails((prev) => ({
                  ...prev,
                  [m._id]: result.scoreDetail as EvaluationScoreDetail,
                }));
              }
            } catch (err) {
              console.error("Evaluation error for match", m._id, err);
            }
          }),
        );

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
      setScrapeNotice((prev) => ({ ...prev, [order._id]: { kind: "error", text } }));
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
        isScraping: false,
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

  const handleScrapeOrder = (order: Doc<"orders">) => {
    // "all" is the default selection, so the single 取得 button covers both the
    // every-portal case and a single-portal case.
    const chosen = scrapeSource[order._id] || "all";
    return dispatchScrape(order, chosen === "all" ? ALL_SCRAPE_SOURCES : [chosen]);
  };

  const [showForm, setShowForm] = useState(false);
  const [wards, setWards] = useState<string[]>([]);
  const [priceMin, setPriceMin] = useState("");
  const [orderName, setOrderName] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [walkMinutes, setWalkMinutes] = useState("");
  const [minBuildingCoverageRatio, setMinBuildingCoverageRatio] = useState("");
  const [minFloorAreaRatio, setMinFloorAreaRatio] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<string[]>([]);
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

  const resetForm = () => {
    setEditingOrderId(null);
    setOrderName("");
    setWards([]);
    setPriceMin("");
    setPriceMax("");
    setWalkMinutes("");
    setMinBuildingCoverageRatio("");
    setMinFloorAreaRatio("");
    setPropertyTypes([]);
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
    setPriceMin(order.priceMin !== undefined ? String(order.priceMin) : "");
    setPriceMax(order.priceMax !== undefined ? String(order.priceMax) : "");
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const orderParams = {
        name: orderName || undefined,
        status: orderStatus,
        customerId: selectedCustomerId || undefined,
        ward: wards.length === 1 ? wards[0] : undefined,
        wards: wards.length > 0 ? wards : undefined,
        priceMin: priceMin ? Number(priceMin) : undefined,
        priceMax: priceMax ? Number(priceMax) : undefined,
        criteria: {
          walkMinutes: walkMinutes ? Number(walkMinutes) : undefined,
          minBuildingCoverageRatio: minBuildingCoverageRatio
            ? Number(minBuildingCoverageRatio)
            : undefined,
          minFloorAreaRatio: minFloorAreaRatio
            ? Number(minFloorAreaRatio)
            : undefined,
        },
        propertyTypes: propertyTypes.length > 0 ? propertyTypes : undefined,
        landSizeMin: landSizeMin ? Number(landSizeMin) : undefined,
        landSizeMax: landSizeMax ? Number(landSizeMax) : undefined,
        buildingSizeMin: buildingSizeMin ? Number(buildingSizeMin) : undefined,
        buildingSizeMax: buildingSizeMax ? Number(buildingSizeMax) : undefined,
        maxBuildAge: maxBuildAge ? Number(maxBuildAge) : undefined,
        minBuildYear: minBuildYear ? Number(minBuildYear) : undefined,
        minYield: minYield ? Number(minYield) : undefined,
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

  const totalOrdersCount = orders?.length ?? 0;
  const activeOrdersCount =
    orders?.filter((o) => o.status === "pending" || o.status === "active")
      .length ?? 0;
  const totalMatchesCount = matches?.length ?? 0;
  const totalEvaluatedCount = Object.keys(evaluations).length;

  return (
    <div className="p-6 md:p-10 space-y-6 max-w-7xl mx-auto">
      {/* ── Page Header ── */}
      <div className="page-header flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div>
          <div className="brand-divider mb-1">
            <FileText className="w-3.5 h-3.5" />
            自動マッチング＆物件評価システム
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[var(--text-primary)]">
            物件検索
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            買主希望条件の登録、全14不動産ポータル横断検索、物件評価を一括管理
          </p>
        </div>
        <Button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm(!showForm);
          }}
          className="h-11 px-5 text-sm font-bold gap-2 rounded-xl"
          style={{
            background: showForm ? "var(--bg-surface-hover)" : "var(--brand)",
            color: showForm ? "var(--text-primary)" : "#fff",
            boxShadow: showForm ? "none" : "0 4px 14px rgba(26,113,0,0.25)",
          }}
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "キャンセル" : "新規オーダー作成"}
        </Button>
      </div>

      {/* ── KPI cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {[
          { icon: FileCheck2,   color: "var(--brand)",        bg: "var(--brand-soft)", label: "登録された依頼数", value: totalOrdersCount,    loading: orders === undefined },
          { icon: CheckCircle2, color: "#0d9488",              bg: "#f0fdfa",           label: "検索完了",         value: activeOrdersCount,   loading: orders === undefined },
          { icon: Building2,    color: "#d97706",              bg: "#fffbeb",           label: "全検索結果",       value: totalMatchesCount,   loading: matches === undefined },
          { icon: FileText,     color: "#7c3aed",              bg: "#f5f3ff",           label: "評価完了数",       value: totalEvaluatedCount, loading: false },
        ].map((kpi, i) => (
          <div key={i} className="kpi-card">
            <div
              className="flex items-center justify-center w-9 h-9 md:w-10 md:h-10 rounded-xl shrink-0"
              style={{ background: kpi.bg, color: kpi.color }}
            >
              <kpi.icon className="w-4 h-4 md:w-5 md:h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] md:text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                {kpi.label}
              </div>
              <div className="text-lg md:text-xl font-extrabold text-[var(--text-primary)] font-data tracking-tight">
                {kpi.loading ? <Skeleton className="h-6 w-10" /> : kpi.value}
              </div>
            </div>
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
                      <option value="">-- 顧客を選択しない (指定なし) --</option>
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

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最低価格 (万円)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 1000"
                      value={priceMin}
                      onChange={(e) => setPriceMin(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最高価格 (万円)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 50000"
                      value={priceMax}
                      onChange={(e) => setPriceMax(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      駅徒歩 (分以内)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 5"
                      value={walkMinutes}
                      onChange={(e) => setWalkMinutes(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>
                </div>
              </div>

              {/* Property Details */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider border-b border-slate-100 pb-2">
                  物件種別・面積条件
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  <div className="space-y-2 md:col-span-3">
                    <Label className="text-sm font-bold text-slate-700">
                      物件種別
                    </Label>
                    <p className="text-xs text-slate-500 font-medium -mt-1">
                      収益物件をお探しの場合は、種別ではなく下の「最低利回り」で指定してください。
                    </p>
                    {/* 収益物件 was removed from this list: it is an investment
                        CATEGORY (bought for rental income), not a building shape,
                        so it belongs on a different axis from 土地/一戸建て/マンション.
                        It also matched nothing — no scraper emits that string — and
                        minYield already expresses the same intent. Orders created
                        before this still work via propertyTypeMatches() in
                        scraper-service/src/services/propertyMatcher.ts. */}
                    <div className="flex flex-wrap gap-3">
                      {["土地", "一戸建て", "マンション", "ビル"].map(
                        (t) => {
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
                        },
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最小土地面積 (㎡)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 30"
                      value={landSizeMin}
                      onChange={(e) => setLandSizeMin(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最大土地面積 (㎡)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 500"
                      value={landSizeMax}
                      onChange={(e) => setLandSizeMax(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最低建ぺい率 (%)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 80"
                      value={minBuildingCoverageRatio}
                      onChange={(e) =>
                        setMinBuildingCoverageRatio(e.target.value)
                      }
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最低容積率 (%)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 200"
                      value={minFloorAreaRatio}
                      onChange={(e) => setMinFloorAreaRatio(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      築年数以内 (年)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 30"
                      value={maxBuildAge}
                      onChange={(e) => setMaxBuildAge(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-bold text-slate-700">
                      最低利回り (%)
                    </Label>
                    <Input
                      type="number"
                      placeholder="例: 5.5"
                      value={minYield}
                      onChange={(e) => setMinYield(e.target.value)}
                      className="h-11 text-base rounded-xl"
                    />
                  </div>
                </div>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center gap-4 pt-4 border-t border-[var(--border-subtle)]">
                <Button type="submit" disabled={creating} size="lg">
                  {creating ? "保存中..." : editingOrderId ? "変更内容を保存" : "作成"}
                </Button>
                {done && (
                  <span className="text-sm font-bold text-[var(--brand)] flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    {editingOrderId ? "オーダーを更新しました" : "オーダーを作成しました"}
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Orders List Section */}
      <div className="space-y-4">
        <h2 className="text-lg font-extrabold text-[var(--text-primary)]">一覧</h2>

        {/* Live GitHub Actions run banner */}
        {activeRun && (orders ?? []).some(isMyRun) && (
          <div className="flex items-center gap-3 p-4 rounded-2xl bg-[var(--brand-soft)] border border-[var(--brand-border)] shadow-xs">
            <RefreshCw className="w-4 h-4 text-[var(--brand)] animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-[#14532d]">
                {activeRun.status === "queued" ? "物件検索の実行を待機中です" : "物件検索を実行中です"}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                完了まで数分〜数十分かかります。物件は取得され次第、自動で一覧に追加されます。
                {activeRun.created_at && ` （開始: ${new Date(activeRun.created_at).toLocaleTimeString("ja-JP")}）`}
              </div>
            </div>
          </div>
        )}

        {orders === undefined ? (
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
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <Building2 className="w-10 h-10 text-[var(--text-muted)]/40 mx-auto mb-3" />
            <p className="text-sm font-bold text-[var(--text-secondary)]">登録済みオーダーがありません</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">「新規オーダー作成」から希望条件を登録してください。</p>
          </div>
        ) : (
          orders.map((order) => {
            const orderMatchList = orderMatches(order._id);
            const matchCount = orderMatchList?.length ?? 0;
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
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle>
                          {order.name || `オーダー #${order._id.slice(0, 6)}`}
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
                          <Badge variant="brand" className="gap-1.5 font-bold py-1 px-2.5 shrink-0">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{activeRun?.status === "queued" ? "取得待機中" : "取得中"}</span>
                          </Badge>
                        )}
                        {matchCount > 0 && (
                          <Badge className="font-extrabold">
                            {matchCount} 件
                          </Badge>
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

                      {/* Criteria Details */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2.5 text-xs font-medium text-[var(--text-secondary)]">
                        {(order.wards?.length ? order.wards : order.ward ? [order.ward] : []).map((w) => (
                          <span key={w} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--brand-soft)] text-[#14532d] text-[11px] font-bold whitespace-nowrap">
                            <MapPin className="w-3 h-3" />{w}
                          </span>
                        ))}
                        <span className="text-[var(--border-strong)]">·</span>
                        <span>価格: <strong className="text-[var(--text-primary)]">
                          {order.priceMin && order.priceMax ? `${order.priceMin.toLocaleString()} 〜 ${order.priceMax.toLocaleString()}`
                            : order.priceMin ? `${order.priceMin.toLocaleString()} 〜`
                            : order.priceMax ? `〜 ${order.priceMax.toLocaleString()}`
                            : "指定なし"} 万円
                        </strong></span>
                        {(order.walkMinutes ?? order.criteria?.walkMinutes) && (
                          <><span className="text-[var(--border-strong)]">·</span><span>徒歩 {order.walkMinutes ?? order.criteria?.walkMinutes} 分以内</span></>
                        )}
                        {order.propertyTypes && order.propertyTypes.length > 0 && (
                          <><span className="text-[var(--border-strong)]">·</span><span>{order.propertyTypes.join("・")}</span></>
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
                            <span>{getOrderSiteLabel(order) || "物件検索中..."}</span>
                          </div>

                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={cancellingOrderId === order._id}
                            onClick={async () => {
                              setCancellingOrderId(order._id);
                              try {
                                const r = (await cancelScrape({
                                  orderId: order._id,
                                })) as { ok?: boolean; error?: string } | undefined;
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
                            }}
                            className="h-9 px-3.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                            title="GitHub Actions で実行中のスクレイピング処理を停止します"
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
                              className="h-9 text-xs font-bold gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg shadow-sm"
                              onClick={() => handleScrapeOrder(order)}
                              title="選択したサイトから物件を取得します"
                            >
                              <Play className="w-3.5 h-3.5" />
                              手動検索
                            </Button>
                          </div>

                          {matchCount > 0 && (
                            <>
                                  <Button
                                variant="outline"
                                size="sm"
                                className="h-9 text-xs font-bold gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg"
                                onClick={() => handleBatchEvaluate(order)}
                                title="通常は取得後に自動評価されます。タブを閉じていた等で未評価が残った場合の予備操作です。"
                                disabled={evaluatingOrderId === order._id}
                              >
                                {evaluatingOrderId === order._id ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
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
                                className="h-9 text-xs font-bold gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg"
                                onClick={() => handleBatchEvaluate(order, true)}
                                title="評価済みの物件も含め、この注文の全物件を評価し直します。"
                                disabled={evaluatingOrderId === order._id}
                              >
                                {evaluatingOrderId === order._id ? (
                                  <>
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" />
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
                                title={selectedCountForOrder === 0 ? "提案する物件を下の一覧から選択してください" : `選択中の ${selectedCountForOrder} 件を提案します`}
                                className={selectedCountForOrder === 0 ? "opacity-50" : ""}
                                onClick={() => setProposalOrder(order)}
                              >
                                <Send className="w-3 h-3" />
                                顧客へ提案・送信{selectedCountForOrder > 0 && ` (${selectedCountForOrder})`}
                              </Button>
                            </>
                          )}
                        </>
                      )}

                      <div className="flex items-center gap-1.5 ml-auto shrink-0">
                        <Button variant="ghost" size="sm" onClick={() => handleEditClick(order)} title="このオーダーを編集">
                          <Edit className="w-3.5 h-3.5" />
                          編集
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(order._id)} title="このオーダーを削除" className="hover:text-red-600 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                          削除
                        </Button>
                      </div>
                    </div>

                    {/* Scrape notice */}
                    {scrapeNotice[order._id] && (
                      <div className={`mt-2 p-3 rounded-xl text-xs font-bold leading-relaxed ${
                        scrapeNotice[order._id].kind === "error"
                          ? "bg-red-50 text-red-700 border border-red-200"
                          : "bg-[var(--brand-soft)] text-[#14532d] border border-[var(--brand-border)]"
                      }`}>
                        {scrapeNotice[order._id].text}
                      </div>
                    )}
                  </div>
                </CardHeader>

                {/* Matched Listings Drawer */}
                {isCardExpanded && matchCount > 0 && orderMatchList && (
                  <CardContent className="p-5 space-y-2">
                    <div className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                      抽出物件一覧 ({matchCount}件)
                    </div>

                    {(() => {
                      const pageSize = showLimit[order._id] || 10;
                      const page = currentPage[order._id] || 1;
                      const sortedMatches = [...orderMatchList].sort((a, b) => {
                        const aEval = a.evaluation || evaluations[a._id];
                        const bEval = b.evaluation || evaluations[b._id];
                        const aScore =
                          a.score ??
                          (aEval
                            ? aEval.match(/評価[：:\s]*(\d+)/)?.[1]
                              ? Number(aEval.match(/評価[：:\s]*(\d+)/)[1])
                              : 0
                            : 0);
                        const bScore =
                          b.score ??
                          (bEval
                            ? bEval.match(/評価[：:\s]*(\d+)/)?.[1]
                              ? Number(bEval.match(/評価[：:\s]*(\d+)/)[1])
                              : 0
                            : 0);
                        return bScore - aScore;
                      });
                      const totalMatches = sortedMatches.length;
                      const totalPages = Math.max(1, Math.ceil(totalMatches / pageSize));
                      const validPage = Math.min(page, totalPages);
                      const startIndex = (validPage - 1) * pageSize;
                      const endIndex = Math.min(startIndex + pageSize, totalMatches);
                      const paginatedMatches = sortedMatches.slice(startIndex, endIndex);

                      return (
                        <>
                          {paginatedMatches.map((m) => {
                            const listing = matchedListing(m.listingId ?? "");
                            const isExpanded = expandedMatch === m._id;
                            const hasEvaluation =
                               evaluations[m._id] !== undefined
                                 ? evaluations[m._id]
                                 : m.evaluation;
                            const scoreDetail: EvaluationScoreDetail | undefined =
                              scoreDetails[m._id] ??
                              (m as Doc<"matching"> & {
                                scoreDetail?: EvaluationScoreDetail;
                              }).scoreDetail;

                        // Extract score from DB score or from evaluation text string
                        const extractedScore =
                          m.score ??
                          (hasEvaluation
                            ? hasEvaluation.match(/評価[：:\s]*(\d+)/)?.[1]
                              ? Number(
                                  hasEvaluation.match(/評価[：:\s]*(\d+)/)[1],
                                )
                              : undefined
                            : undefined);

                        return (
                          <div
                            key={m._id}
                            // Selected rows tint very lightly rather than using a
                            // strong fill: with a long list, a saturated highlight
                            // competes with the 評価 score and source badges. A
                            // faint wash plus a slightly firmer border is enough to
                            // scan which rows are going into the proposal.
                            className={`border rounded-xl overflow-hidden transition-all duration-150 ${
                              selectedForProposal.has(m._id)
                                ? "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300"
                                : "border-slate-200 bg-slate-50/30 hover:border-slate-300"
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
                                  onChange={() => toggleProposalSelection(m._id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 accent-emerald-700 shrink-0 cursor-pointer"
                                  title="提案メールに含める"
                                  aria-label="提案に含める"
                                />
                                <MapPin className="w-3.5 h-3.5 text-[var(--brand)] shrink-0" />
                                <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                                  {listing?.address || m.listingId?.slice(0, 8) || "—"}
                                </span>

                                {/* Source Portal Tag */}
                                {listing?.source && (
                                  <Badge variant="brand" className="text-[10px] shrink-0">
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
                                                  : listing.source === "odakyu"
                                                    ? "小田急"
                                                    : listing.source === "keio"
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
                                )}

                                {/* Property Type Tag */}
                                {listing?.propertyType && (
                                  <Badge variant="neutral" className="text-[10px] shrink-0">
                                    {listing.propertyType}
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
                                  <span className="text-base font-black text-slate-900 font-data">
                                    {listing.price.toLocaleString()}
                                    <span className="text-xs font-normal ml-0.5 text-slate-600">
                                      万円
                                    </span>
                                  </span>
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
                                  </div>
                                  <div>
                                    <div className="text-xs font-bold text-slate-400">
                                      面積
                                    </div>
                                    <div className="text-sm font-semibold text-slate-800 mt-0.5 font-data">
                                      {listing.landSize || listing.area
                                        ? `${listing.landSize || listing.area} ㎡`
                                        : "—"}
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
                                </div>

                                {/* External Link & Google Maps */}
                                <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                                  {listing.url ? (
                                    <a
                                      href={listing.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-800 font-bold text-xs hover:bg-emerald-100 transition-colors"
                                    >
                                      ポータル掲載ページを開く ({listing.source}
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
                                            handleEvaluate(m._id, listing, order)
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
                                        scoreDetail.comparables.length > 0 && (
                                          <div className="mt-2 rounded-lg border border-emerald-100 bg-white/70 p-3">
                                            <div className="text-[11px] font-bold text-emerald-900 mb-1.5">
                                              類似取引事例（国交省データ・面積が近い順）
                                              {scoreDetail.marketAvgPrice != null && (
                                                <span className="ml-2 font-normal text-slate-500">
                                                  平均{" "}
                                                  {scoreDetail.marketAvgPrice.toLocaleString()}
                                                  万円
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
                                                    </span>
                                                    <span>{comp.district || ""}</span>
                                                    <span>
                                                      {comp.station
                                                        ? `${comp.station}駅${comp.walkMinutes ? ` 徒歩${comp.walkMinutes}分` : ""}`
                                                        : ""}
                                                    </span>
                                                    <span>築{comp.buildYear || "不明"}</span>
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
                                        scoreDetail.dataWarnings.length > 0 && (
                                          <div className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 space-y-0.5">
                                            {scoreDetail.dataWarnings.map((w, i) => (
                                              <div key={i}>⚠ {w}</div>
                                            ))}
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
                                全 <span className="font-extrabold text-slate-900">{totalMatches}</span> 件中{" "}
                                <span className="font-extrabold text-slate-900">{startIndex + 1}</span> 〜{" "}
                                <span className="font-extrabold text-slate-900">{endIndex}</span> 件目を表示
                              </div>

                              <div className="flex flex-wrap items-center gap-3">
                                {/* Page Size Selector */}
                                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-bold">
                                  {[10, 25, 50, 9999].map((size) => (
                                    <button
                                      key={size}
                                      type="button"
                                      onClick={() => {
                                        setShowLimit((prev) => ({ ...prev, [order._id]: size }));
                                        setCurrentPage((prev) => ({ ...prev, [order._id]: 1 }));
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
                                        setCurrentPage((prev) => ({ ...prev, [order._id]: validPage - 1 }))
                                      }
                                      className="h-8 px-2.5 text-xs font-bold border-slate-200 rounded-lg text-slate-700"
                                    >
                                      <ChevronLeft className="w-4 h-4 mr-0.5" />
                                      前へ
                                    </Button>

                                    <div className="flex items-center gap-1 px-1">
                                      {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => {
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
                                                setCurrentPage((prev) => ({ ...prev, [order._id]: p }))
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
                                          (p === totalPages - 1 && validPage < totalPages - 2)
                                        ) {
                                          return (
                                            <span key={p} className="text-slate-400 text-xs px-0.5">
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
                                        setCurrentPage((prev) => ({ ...prev, [order._id]: validPage + 1 }))
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
                  </CardContent>
                )}

                {/* Bottom accordion toggle — always the last thing in the card,
                    whether collapsed (button to reveal) or expanded (button to
                    hide again), so it stays reachable at the bottom either way. */}
                {matchCount > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleOrderExpanded(order._id)}
                    className="w-full flex items-center justify-center gap-1.5 py-3 text-xs font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)] border-t border-[var(--border-subtle)] transition-colors"
                  >
                    {isCardExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4" />
                        物件一覧を閉じる
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4" />
                        物件一覧を表示 ({matchCount}件) — クリックして物件を見る
                      </>
                    )}
                  </button>
                )}
              </Card>
            );
          })
        )}
      </div>
      {proposalOrder && (
        <ProposalModal
          order={proposalOrder}
          initialSelectedMatchIds={selectedForProposal}
          orderMatchList={orderMatches(proposalOrder._id) || []}
          matchedListing={matchedListing}
          evaluations={evaluations}
          onClose={() => setProposalOrder(null)}
        />
      )}
    </div>
  );
}