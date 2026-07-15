import { useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { TOKYO_WARDS, wardLabelToCode } from "../lib/tokyoWards";
import { Plus, X, Trash2, MapPin, Train, Ruler, ChevronDown, ChevronUp, ExternalLink, Home, Calendar, Percent, Sparkles, Loader2, Play } from "lucide-react";

const GMAPS_KEY = import.meta.env.VITE_NEXT_PUBLIC_GOOGLE_MAPS_API_KEY as string;
const SCRAPER_URL = import.meta.env.VITE_SCRAPER_URL as string;

export default function OrdersPage() {
  const orders = useQuery(api.orders.list);
  const listings = useQuery(api.listings.list, {});
  const createOrder = useMutation(api.orders.create);
  const deleteOrder = useMutation(api.orders.remove);
  const createListing = useMutation(api.listings.create);
  const createMatching = useMutation(api.matching.create);
  const saveScore = useMutation(api.matching.saveScore);
  const matches = useQuery(api.matching.list);
  const evaluateListing = useAction(api.evaluate.evaluateListing);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [evaluatingId, setEvaluatingId] = useState<string | null>(null);
  const [evaluations, setEvaluations] = useState<Record<string, string>>({});
  const [scrapingOrderId, setScrapingOrderId] = useState<string | null>(null);
  const [evaluatingOrderId, setEvaluatingOrderId] = useState<string | null>(null);
  const [evaluatingMatchId, setEvaluatingMatchId] = useState<string | null>(null);
  const [scrapeSource, setScrapeSource] = useState<Record<string, string>>({});


  const [showLimit, setShowLimit] = useState<Record<string, number>>({});

  console.log("evaluations", evaluations)

  const toggleExpand = (id: string) => {
    setExpandedMatch(expandedMatch === id ? null : id);
  };

  const handleEvaluate = async (matchId: string, listing: any) => {
    setEvaluatingId(matchId);
    try {
      const result = await evaluateListing({
        matchId: matchId,
        address: listing.address,
        ward: listing.ward,
        price: listing.price,
        landSize: listing.landSize,
        buildingCoverageRatio: listing.buildingCoverageRatio,
        floorAreaRatio: listing.floorAreaRatio,
        walkMinutes: listing.walkMinutes,
        station: listing.station,
        buildYear: listing.buildYear,
        roadWidth: listing.roadWidth,
        frontage: listing.frontage,
        rooms: listing.rooms,
        layout: listing.layout,
        description: listing.description,
      });
      setEvaluations((prev) => ({
        ...prev,
        [matchId]: result.evaluation || result.error || "評価エラー",
      }));
    } catch (err) {
      setEvaluations((prev) => ({
        ...prev,
        [matchId]: `エラー: ${err instanceof Error ? err.message : String(err)}`,
      }));
    } finally {
      setEvaluatingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteOrder({ id: id as any });
  };

  const handleScrapeOrder = async (order: any, source?: string) => {
    setScrapingOrderId(order._id);
    try {
      // Determine area codes from single ward, multiple wards, or all
      const orderWards = order.wards && order.wards.length > 0 ? order.wards : (order.ward ? [order.ward] : []);
      const codes = orderWards.length > 0
        ? orderWards.map((w: string) => wardLabelToCode(w)).filter(Boolean) as string[]
        : ["13101", "13102", "13103", "13104", "13105", "13106", "13107", "13108",
           "13109", "13110", "13111", "13112", "13113", "13114", "13115", "13116",
           "13117", "13118", "13119", "13120", "13121", "13122", "13123"];

      const orderCriteria = [{
        ward: order.ward || undefined,
        wards: order.wards && order.wards.length > 0 ? order.wards : undefined,
        priceMin: order.priceMin || undefined,
        priceMax: order.priceMax || undefined,
        walkMinutes: order.walkMinutes ?? order.criteria?.walkMinutes ?? undefined,
        minBuildingCoverageRatio: order.minBuildingCoverageRatio ?? order.criteria?.minBuildingCoverageRatio ?? undefined,
        minFloorAreaRatio: order.minFloorAreaRatio ?? order.criteria?.minFloorAreaRatio ?? undefined,
        propertyTypes: order.propertyTypes ?? undefined,
        landSizeMin: order.landSizeMin ?? undefined,
        landSizeMax: order.landSizeMax ?? undefined,
        buildingSizeMin: order.buildingSizeMin ?? undefined,
        buildingSizeMax: order.buildingSizeMax ?? undefined,
        // New filter options
        maxBuildAge: order.maxBuildAge ?? undefined,
        minBuildYear: order.minBuildYear ?? undefined,
        minYield: order.minYield ?? undefined,
        maxYield: order.maxYield ?? undefined,
        minRoadWidth: order.minRoadWidth ?? undefined,
        minTotalUnits: order.minTotalUnits ?? undefined,
        maxFloor: order.maxFloor ?? undefined,
        excludeFirstFloor: order.excludeFirstFloor ?? undefined,
        minElevators: order.minElevators ?? undefined,
        structureTypes: order.structureTypes ?? undefined,
        layoutTypes: order.layoutTypes ?? undefined,
      }].filter((o) => Object.values(o).some((v) => v !== undefined));

      const src = source || scrapeSource[order._id] || "athome";
      const res = await fetch(
        `${SCRAPER_URL}/scrape?areaCodes=${codes.slice(0, 3).join(",")}&source=${src}&orders=${encodeURIComponent(JSON.stringify(orderCriteria))}`
      );
      const data = await res.json();

      if (data.listings && Array.isArray(data.listings)) {
        const seen = new Set<string>();
        // Build lookup maps from existing listings
        const urlToListingId = new Map<string, any>();
        const addrToListingId = new Map<string, any>();
        if (listings) {
          for (const l of listings) {
            if (l.url) urlToListingId.set(l.url, l._id);
            const key = `${l.address}|${l.price}|${l.ward}`;
            addrToListingId.set(key, l._id);
          }
        }
        // Build lookup of existing matches to avoid dupes
        const existingMatchKeys = new Set<string>();
        if (matches && order._id) {
          for (const m of matches) {
            if (m.orderId === order._id) {
              existingMatchKeys.add(m.listingId);
            }
          }
        }
        for (const item of data.listings) {
          const itemUrl = item.detailUrl || item.url || "";
          if (seen.has(itemUrl)) continue;
          seen.add(itemUrl);
          const addrKey = `${item.address}|${item.price}|${item.ward}`;
          if (!itemUrl && seen.has(addrKey)) continue;
          seen.add(addrKey);

          // Check if listing already exists by URL or address+price
          let listingId = itemUrl ? urlToListingId.get(itemUrl) : null;
          if (!listingId) listingId = addrToListingId.get(addrKey);
          if (!listingId) {
            listingId = await createListing({
              address: item.address || undefined,
              ward: item.ward || undefined,
              price: item.price ? Number(item.price) : undefined,
              area: item.area ? Number(item.area) : undefined,
              buildYear: item.buildYear ? Number(item.buildYear) : undefined,
              source: src,
              status: "new",
              url: itemUrl || undefined,
              description: item.description || undefined,
              station: item.station || undefined,
              walkMinutes: item.walkMinutes ? Number(item.walkMinutes) : undefined,
              rooms: item.rooms ? Number(item.rooms) : undefined,
              layout: item.layout || undefined,
              buildingCoverageRatio: item.buildingCoverageRatio != null ? Number(item.buildingCoverageRatio) : undefined,
              floorAreaRatio: item.floorAreaRatio != null ? Number(item.floorAreaRatio) : undefined,
              propertyType: item.propertyType || undefined,
            });
          }
          // Skip if match already exists for this order+listing
          if (existingMatchKeys.has(listingId)) continue;
          // Save match record
          await createMatching({
            orderId: order._id,
            listingId: listingId,
            status: "matched",
          });
        }
      } else {
        // No listings found
      }
    } catch (err) {
      console.error("Scrape error:", err);
    } finally {
      setScrapingOrderId(null);
    }
  };

  const handleScrapeAll = async (order: any) => {
    setScrapingOrderId(order._id);
    try {
      for (const src of ["athome", "hatomark", "kenbiya", "rakuten", "suumo"]) {
        await handleScrapeOrder(order, src);
      }
    } finally {
      setScrapingOrderId(null);
    }
  };

  const handleBatchEvaluate = async (order: any) => {
    setEvaluatingOrderId(order._id);
    const orderMatchList = matches?.filter((m) => m.orderId === order._id) ?? [];
    for (const m of orderMatchList) {
      const listing = listings?.find((l) => l._id === m.listingId);
      if (listing && !evaluations[m._id]) {
        setEvaluatingMatchId(m._id);
        try {
          const result = await evaluateListing({
            matchId: m._id,
            address: listing.address,
            ward: listing.ward,
            price: listing.price,
            landSize: listing.landSize,
            buildingCoverageRatio: listing.buildingCoverageRatio,
            floorAreaRatio: listing.floorAreaRatio,
            walkMinutes: listing.walkMinutes,
            station: listing.station,
            buildYear: listing.buildYear,
            roadWidth: listing.roadWidth,
            frontage: listing.frontage,
            rooms: listing.rooms,
            layout: listing.layout,
            description: listing.description,
          });
          setEvaluations((prev) => ({
            ...prev,
            [m._id]: result.evaluation || result.error || "評価エラー",
          }));
        } catch {
          // skip failed ones
        }
      }
    }
    setEvaluatingMatchId(null);
    setEvaluatingOrderId(null);
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
  // New filter state
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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createOrder({
        name: orderName || undefined,
        ward: wards.length === 1 ? wards[0] : undefined,
        wards: wards.length > 0 ? wards : undefined,
        priceMin: priceMin ? Number(priceMin) : undefined,
        priceMax: priceMax ? Number(priceMax) : undefined,
        criteria: {
          walkMinutes: walkMinutes ? Number(walkMinutes) : undefined,
          minBuildingCoverageRatio: minBuildingCoverageRatio ? Number(minBuildingCoverageRatio) : undefined,
          minFloorAreaRatio: minFloorAreaRatio ? Number(minFloorAreaRatio) : undefined,
        },
        propertyTypes: propertyTypes.length > 0 ? propertyTypes : undefined,
        landSizeMin: landSizeMin ? Number(landSizeMin) : undefined,
        landSizeMax: landSizeMax ? Number(landSizeMax) : undefined,
        buildingSizeMin: buildingSizeMin ? Number(buildingSizeMin) : undefined,
        buildingSizeMax: buildingSizeMax ? Number(buildingSizeMax) : undefined,
        // New filter options
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
        status: "pending",
      });
      setDone(true);
      setOrderName(""); setWards([]); setPriceMin(""); setPriceMax("");
      setWalkMinutes(""); setMinBuildingCoverageRatio(""); setMinFloorAreaRatio("");
      setPropertyTypes([]); setLandSizeMin(""); setLandSizeMax(""); setBuildingSizeMin(""); setBuildingSizeMax("");
      setMaxBuildAge(""); setMinBuildYear(""); setMinYield(""); setMaxYield("");
      setMinRoadWidth(""); setMinTotalUnits(""); setMaxFloor(""); setExcludeFirstFloor(false);
      setMinElevators(""); setStructureTypes([]); setLayoutTypes([]);
      setShowForm(false);
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      console.error("Failed to create order:", err);
    } finally {
      setCreating(false);
    }
  };

  const orderMatches = (orderId: string) =>
    matches === undefined ? undefined : matches.filter((m) => m.orderId === orderId);

  const matchedListing = (listingId: string) =>
    listings?.find((l) => l._id === listingId);

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-3xl font-bold tracking-tight">オーダー</h1>
          <p className="text-sm text-muted-foreground/60 mt-1">物件検索オーダーと進捗管理</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "キャンセル" : "新規オーダー"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-lg">新規オーダー作成</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2 md:col-span-2 lg:col-span-3">
                  <Label>オーダー名</Label>
                  <Input placeholder="例: 渋谷区 商業用地サーチ" value={orderName} onChange={(e) => setOrderName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>対象区 (複数選択可)</Label>
                  <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto border border-input rounded p-2">
                    {TOKYO_WARDS.map((w) => (
                      <label key={w.code} className="flex items-center gap-1 text-xs cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={wards.includes(w.label)} onChange={() => setWards((prev) => prev.includes(w.label) ? prev.filter((x) => x !== w.label) : [...prev, w.label])} className="cursor-pointer" />
                        {w.label}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2"><Label>最低価格 (万円)</Label><Input type="number" placeholder="例: 1000" value={priceMin} onChange={(e) => setPriceMin(e.target.value)} /></div>
                <div className="space-y-2"><Label>最高価格 (万円)</Label><Input type="number" placeholder="例: 50000" value={priceMax} onChange={(e) => setPriceMax(e.target.value)} /></div>
                <div className="space-y-2"><Label>駅徒歩 (分) 以内</Label><Input type="number" placeholder="例: 5" value={walkMinutes} onChange={(e) => setWalkMinutes(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低建ぺい率 (%)</Label><Input type="number" placeholder="例: 80" value={minBuildingCoverageRatio} onChange={(e) => setMinBuildingCoverageRatio(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低容積率 (%)</Label><Input type="number" placeholder="例: 200" value={minFloorAreaRatio} onChange={(e) => setMinFloorAreaRatio(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>物件種別</Label>
                  <div className="flex flex-wrap gap-2">
                    {["土地", "一戸建て", "マンション"].map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={propertyTypes.includes(t)} onChange={() => setPropertyTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])} className="cursor-pointer" />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2"><Label>最小土地面積 (㎡)</Label><Input type="number" placeholder="例: 30" value={landSizeMin} onChange={(e) => setLandSizeMin(e.target.value)} /></div>
                <div className="space-y-2"><Label>最大土地面積 (㎡)</Label><Input type="number" placeholder="例: 500" value={landSizeMax} onChange={(e) => setLandSizeMax(e.target.value)} /></div>
                <div className="space-y-2"><Label>最小建物面積 (㎡)</Label><Input type="number" placeholder="例: 50" value={buildingSizeMin} onChange={(e) => setBuildingSizeMin(e.target.value)} /></div>
                <div className="space-y-2"><Label>最大建物面積 (㎡)</Label><Input type="number" placeholder="例: 300" value={buildingSizeMax} onChange={(e) => setBuildingSizeMax(e.target.value)} /></div>
                {/* --- NEW FILTER FIELDS --- */}
                <div className="space-y-2"><Label>築年数以内 (年)</Label><Input type="number" placeholder="例: 30" value={maxBuildAge} onChange={(e) => setMaxBuildAge(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低築年 (西暦)</Label><Input type="number" placeholder="例: 2020" value={minBuildYear} onChange={(e) => setMinBuildYear(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低利回り (%)</Label><Input type="number" placeholder="例: 5" value={minYield} onChange={(e) => setMinYield(e.target.value)} /></div>
                <div className="space-y-2"><Label>最高利回り (%)</Label><Input type="number" placeholder="例: 7" value={maxYield} onChange={(e) => setMaxYield(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低道路幅員 (m)</Label><Input type="number" placeholder="例: 8" value={minRoadWidth} onChange={(e) => setMinRoadWidth(e.target.value)} /></div>
                <div className="space-y-2"><Label>最低総戸数</Label><Input type="number" placeholder="例: 20" value={minTotalUnits} onChange={(e) => setMinTotalUnits(e.target.value)} /></div>
                <div className="space-y-2"><Label>最高階数</Label><Input type="number" placeholder="例: 5" value={maxFloor} onChange={(e) => setMaxFloor(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>一階不可</Label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer h-10">
                    <input type="checkbox" checked={excludeFirstFloor} onChange={() => setExcludeFirstFloor(!excludeFirstFloor)} className="cursor-pointer" />
                    一階を除外
                  </label>
                </div>
                <div className="space-y-2"><Label>最低エレベーター数</Label><Input type="number" placeholder="例: 2" value={minElevators} onChange={(e) => setMinElevators(e.target.value)} /></div>
                <div className="space-y-2">
                  <Label>構造種別</Label>
                  <div className="flex flex-wrap gap-2">
                    {["RC", "SRC", "S", "木造", "鉄骨造"].map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={structureTypes.includes(t)} onChange={() => setStructureTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])} className="cursor-pointer" />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>間取りタイプ</Label>
                  <div className="flex flex-wrap gap-2">
                    {["ファミリー", "1K", "1DK", "1LDK", "2K", "2DK", "2LDK", "3LDK"].map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={layoutTypes.includes(t)} onChange={() => setLayoutTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])} className="cursor-pointer" />
                        {t}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={creating}>{creating ? "作成中..." : "オーダーを作成"}</Button>
                {done && <span className="text-sm text-primary font-medium">✓ オーダーを作成しました</span>}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Order cards */}
      {orders === undefined ? (
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      ) : orders.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">オーダーはまだありません。「新規オーダー」から作成してください。</CardContent></Card>
      ) : (
        orders.map((order) => {
          const orderMatchList = orderMatches(order._id);
          const matchCount = orderMatchList?.length ?? 0;
          return (
            <Card key={order._id} className="shadow-sm border-border/80">
              <CardHeader className="flex flex-row items-start justify-between px-6 pt-6 pb-4">
                <div>
                  <CardTitle className="text-xl font-semibold tracking-tight">{order.name || `${order._id.slice(0, 8)}...`}</CardTitle>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {order.ward && <Badge variant="secondary">{order.ward}</Badge>}
                    <Badge variant={order.status === "completed" ? "default" : "secondary"}>
                      {order.status === "completed" ? "完了" : "保留中"}
                    </Badge>
                    {matchCount > 0 && <Badge variant="default">{matchCount} 件マッチ</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    価格: {order.priceMin && order.priceMax
                      ? `${order.priceMin.toLocaleString()} - ${order.priceMax.toLocaleString()}`
                      : order.priceMin ? `${order.priceMin.toLocaleString()} 〜`
                      : order.priceMax ? `〜 ${order.priceMax.toLocaleString()}`
                      : "指定なし"} 万円
                    {order.areaMin || order.areaMax
                      ? ` | 面積: ${order.areaMin ?? ""}〜${order.areaMax ?? ""}㎡`
                      : ""}
                    {(order.walkMinutes ?? order.criteria?.walkMinutes) && ` | 徒歩${order.walkMinutes ?? order.criteria?.walkMinutes}分以内`}
                    {(order.minBuildingCoverageRatio ?? order.criteria?.minBuildingCoverageRatio) && ` | 建ぺい率${order.minBuildingCoverageRatio ?? order.criteria?.minBuildingCoverageRatio}%以上`}
                    {(order.minFloorAreaRatio ?? order.criteria?.minFloorAreaRatio) && ` | 容積率${order.minFloorAreaRatio ?? order.criteria?.minFloorAreaRatio}%以上`}
                    {order.propertyTypes && order.propertyTypes.length > 0 && ` | ${order.propertyTypes.join("・")}`}
                    {order.landSizeMin && ` | 土地${order.landSizeMin}㎡〜`}
                    {order.landSizeMax && ` | 土地〜${order.landSizeMax}㎡`}
                    {order.buildingSizeMin && ` | 建物${order.buildingSizeMin}㎡〜`}
                    {order.buildingSizeMax && ` | 建物〜${order.buildingSizeMax}㎡`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {scrapingOrderId === order._id ? (
                    <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> 取得中...
                    </span>
                  ) : (
                    <>
                      <select
                        className="h-7 text-[10px] border border-border bg-transparent px-1 rounded cursor-pointer"
                        value={scrapeSource[order._id] || "athome"}
                        onChange={(e) => setScrapeSource((prev) => ({ ...prev, [order._id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="athome">At Home</option>
                        <option value="hatomark">鳩マーク</option>
                        <option value="kenbiya">健美家</option>
                        <option value="rakuten">楽天</option>
                        <option value="suumo">SUUMO</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => handleScrapeOrder(order)}
                      >
                        <Play className="w-3 h-3" />
                        取得
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1 text-primary border-primary/30"
                        onClick={() => handleScrapeAll(order)}
                        title="全サイトから物件取得"
                      >
                        <Play className="w-3 h-3" />
                        一括
                      </Button>
                      {matchCount > 0 && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleBatchEvaluate(order)}
                            disabled={evaluatingOrderId === order._id}
                          >
                            {evaluatingOrderId === order._id ? (
                              <><Loader2 className="w-3 h-3 animate-spin" /> 評価中...</>
                            ) : (
                              <>自動評価</>
                            )}
                          </Button>

                        </>
                      )}
                    </>
                  )}
                  <button onClick={() => handleDelete(order._id)} className="p-1 text-muted-foreground/40 hover:text-red-500 transition-colors" title="削除">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </CardHeader>
              {matchCount > 0 && orderMatchList && (
                <CardContent className="pt-0">
                  <div className="space-y-2">
                    {[...orderMatchList].sort((a, b) => ((b as any).score ?? 0) - ((a as any).score ?? 0)).slice(0, showLimit[order._id] || 10).map((m) => {
                      const listing = matchedListing(m.listingId ?? "");
                      const isExpanded = expandedMatch === m._id;
                      return (
                        <div key={m._id}>
                          {/* Clickable row */}
                          <div
                            className="flex items-center justify-between p-2 bg-muted text-sm cursor-pointer hover:bg-muted/80 transition-colors"
                            onClick={() => toggleExpand(m._id)}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="truncate">{listing?.address || m.listingId?.slice(0, 8) || "—"}</span>
                              {listing?.source && (
                                <span className={`text-[10px] font-medium px-1 py-0.5 rounded shrink-0 ${
                                  listing.source === "athome" ? "bg-blue-100 text-blue-700" :
                                  listing.source === "rakuten" ? "bg-red-100 text-red-700" :
                                  listing.source === "hatomark" ? "bg-green-100 text-green-700" :
                                  listing.source === "kenbiya" ? "bg-purple-100 text-purple-700" :
                                  listing.source === "suumo" ? "bg-orange-100 text-orange-700" :
                                  "bg-gray-100 text-gray-600"
                                }`}>
                                  {listing.source === "athome" ? "At Home" : listing.source === "rakuten" ? "楽天" : listing.source === "hatomark" ? "鳩マーク" : listing.source === "kenbiya" ? "健美家" : listing.source === "suumo" ? "SUUMO" : listing.source}
                                </span>
                              )}
                              {listing?.propertyType && (
                                <span className={`text-[10px] font-medium px-1 py-0.5 rounded shrink-0 ${
                                  listing.propertyType === "土地" ? "bg-yellow-100 text-yellow-700" :
                                  listing.propertyType === "一戸建て" ? "bg-teal-100 text-teal-700" :
                                  listing.propertyType === "マンション" ? "bg-pink-100 text-pink-700" :
                                  "bg-gray-100 text-gray-500"
                                }`}>
                                  {listing.propertyType}
                                </span>
                              )}
                              {((m as any).evaluation || evaluations[m._id]) && (
                                <span className="text-xs text-muted-foreground/50 truncate max-w-[200px] ml-1">
                                  {((m as any).evaluation || evaluations[m._id]).split(/[。\n]/)[0]}。
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0 text-muted-foreground">
                              {evaluatingMatchId === m._id || evaluatingId === m._id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                              ) : null}
                              {/* Score badge */}
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const current = (m as any).score;
                                  const next = current >= 100 ? 0 : (current || 0) + 10;
                                  saveScore({ matchId: m._id as any, score: next });
                                }}
                                className="inline-flex items-center gap-1 cursor-pointer group"
                                title="クリックでスコア変更"
                              >
                                <span className={`text-xs font-bold tabular-nums ${
                                  (m as any).score >= 80 ? "text-green-600" :
                                  (m as any).score >= 60 ? "text-emerald-500" :
                                  (m as any).score >= 40 ? "text-amber-500" :
                                  (m as any).score > 0 ? "text-red-500" :
                                  "text-muted-foreground/40"
                                }`}>
                                  {(m as any).score > 0 ? (m as any).score : "—"}
                                </span>
                                {(m as any).score > 0 && (
                                  <span className="w-10 h-1.5 bg-muted-foreground/10 rounded-full overflow-hidden">
                                    <span
                                      className={`block h-full transition-all ${
                                        (m as any).score >= 80 ? "bg-green-500" :
                                        (m as any).score >= 60 ? "bg-emerald-400" :
                                        (m as any).score >= 40 ? "bg-amber-400" :
                                        "bg-red-400"
                                      }`}
                                      style={{ width: `${(m as any).score}%` }}
                                    />
                                  </span>
                                )}
                              </span>
                              {listing?.price && <span className="font-data">{listing.price.toLocaleString()}万円</span>}
                              {listing?.walkMinutes !== undefined && (
                                <span className="flex items-center gap-1"><Train className="w-3 h-3" />{listing.walkMinutes}分</span>
                              )}
                              {listing?.landSize && <span className="flex items-center gap-1"><Ruler className="w-3 h-3" />{listing.landSize}㎡</span>}
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5 ml-1" /> : <ChevronDown className="w-3.5 h-3.5 ml-1" />}
                            </div>
                          </div>
                          {/* Expanded details */}
                          {isExpanded && listing && (
                            <div className="border border-border/50 bg-muted/30 p-3 space-y-3 text-sm">
                              {/* Map + Details side by side */}
                              <div className="flex flex-col sm:flex-row gap-3">
                                {/* Details - left half */}
                                <div className="flex-1 space-y-2">
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                                    {listing.price && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">価格:</span>
                                        <span className="font-medium">{listing.price.toLocaleString()}万円</span>
                                      </div>
                                    )}
                                    {listing.landSize && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Ruler className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">土地:</span>
                                        <span className="font-medium">{listing.landSize}㎡</span>
                                      </div>
                                    )}
                                    {listing.area && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Ruler className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">面積:</span>
                                        <span className="font-medium">{listing.area}㎡</span>
                                      </div>
                                    )}
                                    {listing.station && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Train className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">駅:</span>
                                        <span className="font-medium">{listing.station}</span>
                                      </div>
                                    )}
                                    {listing.walkMinutes !== undefined && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Train className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">徒歩:</span>
                                        <span className="font-medium">{listing.walkMinutes}分</span>
                                      </div>
                                    )}
                                    {listing.buildingCoverageRatio != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Percent className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">建ぺい率:</span>
                                        <span className="font-medium">{listing.buildingCoverageRatio}%</span>
                                      </div>
                                    )}
                                    {listing.floorAreaRatio != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Percent className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">容積率:</span>
                                        <span className="font-medium">{listing.floorAreaRatio}%</span>
                                      </div>
                                    )}
                                    {listing.buildYear && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">築年:</span>
                                        <span className="font-medium">{listing.buildYear}年</span>
                                      </div>
                                    )}
                                    {listing.rooms != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <Home className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="text-muted-foreground shrink-0">間取り:</span>
                                        <span className="font-medium">{listing.layout || `${listing.rooms}室`}</span>
                                      </div>
                                    )}
                                    {listing.roadWidth != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">道路幅:</span>
                                        <span className="font-medium">{listing.roadWidth}m</span>
                                      </div>
                                    )}
                                    {listing.frontage != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">間口:</span>
                                        <span className="font-medium">{listing.frontage}m</span>
                                      </div>
                                    )}
                                    {listing.mlitBenchmark != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">MLIT:</span>
                                        <span className="font-medium">{listing.mlitBenchmark}</span>
                                      </div>
                                    )}
                                    {listing.score != null && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">スコア:</span>
                                        <span className="font-medium">{listing.score}</span>
                                      </div>
                                    )}
                                    {listing.source && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">情報元:</span>
                                        {listing.url ? (
                                          <a href={listing.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline inline-flex items-center gap-1">
                                            {listing.source === "athome" ? "At Home" : listing.source === "rakuten" ? "楽天不動産" : listing.source === "hatomark" ? "鳩マークサイト" : listing.source === "kenbiya" ? "健美家" : listing.source === "suumo" ? "SUUMO" : listing.source}
                                            <ExternalLink className="w-3 h-3" />
                                          </a>
                                        ) : (
                                          <span className="font-medium">{listing.source}</span>
                                        )}
                                      </div>
                                    )}
                                    {listing.propertyType && (
                                      <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-muted-foreground shrink-0">種別:</span>
                                        <span className="font-medium">{listing.propertyType}</span>
                                      </div>
                                    )}
                                  </div>
                                  {/* Description */}
                                  {listing.description && (
                                    <p className="text-xs text-muted-foreground leading-relaxed pt-1">{listing.description}</p>
                                  )}
                                </div>
                                {/* Map - right half */}
                                {listing.address && GMAPS_KEY && (
                                  <div className="w-full sm:w-1/2 h-48 overflow-hidden shrink-0">
                                    <iframe
                                      title="Google Maps"
                                      width="100%"
                                      height="100%"
                                      style={{ border: 0 }}
                                      loading="lazy"
                                      referrerPolicy="no-referrer-when-downgrade"
                                      src={`https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${encodeURIComponent(
                                        (listing.address || "")
                                          .replace(/[（(][^)）]*[)）]/g, "")
                                          .replace(/\s*(住宅用地|その他用地|商業用地)\s*$/, "")
                                          .trim() + " 東京"
                                      )}&zoom=15`}
                                    />
                                  </div>
                                )}
                              </div>
                              {/* Rax Evaluation */}
                              <div className="border-t border-border/50 pt-2">
                                {(m as any).evaluation || evaluations[m._id] ? (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <b className="flex items-center gap-1">
                                        分析
                                      </b>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 text-xs"
                                        onClick={() => handleEvaluate(m._id, listing)}
                                      >
                                        再評価
                                      </Button>
                                    </div>
                                    <div className="text-xs whitespace-pre-wrap leading-relaxed">
                                      {(m as any).evaluation || evaluations[m._id]}
                                    </div>
                                  </div>
                                ) : (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-8 text-xs gap-1"
                                    onClick={() => handleEvaluate(m._id, listing)}
                                    disabled={evaluatingId === m._id}
                                  >
                                    {evaluatingId === m._id ? (
                                      <><Loader2 className="w-3 h-3 animate-spin" /> 評価中...</>
                                    ) : (
                                      <><Sparkles className="w-3 h-3" /> Raxで分析</>
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {(showLimit[order._id] || 10) < matchCount ? (
                      <button
                        onClick={() =>
                          setShowLimit((prev) => ({
                            ...prev,
                            [order._id]: (prev[order._id] || 10) + 10,
                          }))
                        }
                        className="w-full text-xs text-primary hover:text-primary/80 text-center py-2 transition-colors"
                      >
                        あと{matchCount - (showLimit[order._id] || 10)}件を表示
                      </button>
                    ) : matchCount > 0 ? (
                      <p className="text-xs text-muted-foreground text-center pt-1">全{matchCount}件表示中</p>
                    ) : null}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}