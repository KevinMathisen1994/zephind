import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { useApiQuery as useQuery } from "../hooks/useApi";
import { api } from "../lib/api";
import TokyoPropertyMap, { type MapListingItem } from "../components/TokyoPropertyMap";
import {
  Compass,
  Sparkles,
  Building2,
  TrendingUp,
  Search,
} from "lucide-react";

export default function MapIntelligencePage() {
  const navigate = useNavigate();
  // Query listings from database
  const allListings = useQuery(api.listings.list, { limit: 1500 });

  const [searchQuery, setSearchQuery] = useState("");
  const [minYield, setMinYield] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(0); // 0 = no limit
  const [selectedStructure, setSelectedStructure] = useState<string>("all");
  const [selectedListing, setSelectedListing] = useState<MapListingItem | null>(null);
  // Normalize listings for the map
  const normalizedListings: MapListingItem[] = useMemo(() => {
    if (!allListings) return [];
    return allListings.map((l: any) => ({
      _id: l._id,
      id: l._id,
      title: l.title,
      address: l.address,
      ward: l.ward,
      price: l.price,
      rent: l.rent,
      yield: l.yield || l.grossYield || l.netYield,
      grossYield: l.grossYield,
      netYield: l.netYield,
      station: l.station,
      stationName: l.stationName,
      walkMinutes: l.walkMinutes || l.walkingMinutes,
      walkingMinutes: l.walkingMinutes || l.walkMinutes,
      structure: l.structure,
      structureType: l.structureType,
      area: l.area,
      buildYear: l.buildYear,
      score: l.score,
      images: l.images,
      url: l.url,
      source: l.source,
      latitude: l.latitude,
      longitude: l.longitude,
      dealType: l.dealType,
    }));
  }, [allListings]);

  // /map?focus=<listingId> — arriving from a property's hazard panel. Selecting
  // it here makes the map fly to that property instead of opening at city zoom.
  // The caller also passes the property itself in router state: this page only
  // loads a slice of all listings, and an id lookup that misses produced a map
  // that simply stayed zoomed out.
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const focusListingId = searchParams.get("focus");
  const focusFromState = (
    location.state as { focusListing?: MapListingItem } | null
  )?.focusListing;
  useEffect(() => {
    if (focusFromState) {
      setSelectedListing(focusFromState);
      return;
    }
    if (!focusListingId) return;
    const found = normalizedListings.find(
      (l) => (l._id || l.id) === focusListingId,
    );
    if (found) setSelectedListing(found);
  }, [focusListingId, focusFromState, normalizedListings]);

  // Filter listings
  const filteredListings = useMemo(() => {
    return normalizedListings.filter((l) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchTitle = l.title?.toLowerCase().includes(q);
        const matchAddr = l.address?.toLowerCase().includes(q);
        const matchStation = (l.station || l.stationName)?.toLowerCase().includes(q);
        if (!matchTitle && !matchAddr && !matchStation) return false;
      }
      if (minYield > 0) {
        const y = l.yield || 0;
        if (y < minYield) return false;
      }
      if (maxPrice > 0 && l.price) {
        if (l.price > maxPrice) return false;
      }
      if (selectedStructure !== "all" && l.structureType) {
        if (l.structureType !== selectedStructure) return false;
      }
      return true;
    });
  }, [normalizedListings, searchQuery, minYield, maxPrice, selectedStructure]);

  // The property handed over by the hazard panel may not be in this page's
  // slice of listings (or may be filtered out). Append it, or the map is asked
  // to focus on something it cannot draw.
  const mapListings = useMemo(() => {
    const id = focusFromState?._id || focusFromState?.id;
    if (!id) return filteredListings;
    if (filteredListings.some((l) => (l._id || l.id) === id)) {
      return filteredListings;
    }
    return [focusFromState as MapListingItem, ...filteredListings];
  }, [filteredListings, focusFromState]);

  // Aggregate stats for Tokyo
  const stats = useMemo(() => {
    const validYields = filteredListings
      .map((l) => l.yield)
      .filter((y): y is number => typeof y === "number" && y > 0);
    const avgYield = validYields.length > 0 ? validYields.reduce((a, b) => a + b, 0) / validYields.length : 0;
    const highScores = filteredListings.filter((l) => l.score && l.score >= 80).length;
    return {
      total: filteredListings.length,
      avgYield: avgYield.toFixed(2),
      highScores,
    };
  }, [filteredListings]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] lg:h-screen overflow-hidden bg-[#f6f3ec]">
      {/* ── Top Header & Live Pulse ── */}
      <div className="shrink-0 p-4 pb-2 border-b border-[var(--border-subtle)] bg-[#fffdf9]/90 backdrop-blur-md space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xs">
              <Compass className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-xl font-bold tracking-tight text-[var(--text-primary)]">
                  東京広域 地図インテリジェンス
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-[13.5px] font-black tracking-wider uppercase border border-emerald-200">
                  GIS ANALYTICS
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                物件立地・ハザード水害リスク・駅徒歩圏・利回り分布の統合リアルタイム可視化
              </p>
            </div>
          </div>

          {/* Quick Metrics (Double-Bezel Mini Pills) */}
          <div className="flex items-center gap-2">
            <div className="rounded-xl bg-black/[0.04] p-1 ring-1 ring-black/[0.06]">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[calc(0.75rem-0.125rem)] bg-white shadow-2xs">
                <Building2 className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-xs font-bold text-slate-700">プロット物件:</span>
                <span className="font-data font-black text-slate-900">{stats.total}件</span>
              </div>
            </div>

            <div className="rounded-xl bg-black/[0.04] p-1 ring-1 ring-black/[0.06]">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[calc(0.75rem-0.125rem)] bg-white shadow-2xs">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-bold text-slate-700">平均想定利回り:</span>
                <span className="font-data font-black text-emerald-700">{stats.avgYield}%</span>
              </div>
            </div>

            <div className="rounded-xl bg-black/[0.04] p-1 ring-1 ring-black/[0.06]">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-[calc(0.75rem-0.125rem)] bg-white shadow-2xs">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-xs font-bold text-slate-700">AI高評価:</span>
                <span className="font-data font-black text-amber-700">{stats.highScores}件</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Workspace: Filters & Full Interactive Map ── */}
      <div className="flex-1 min-h-0 relative flex flex-col p-4 pt-3">
        {/* Filter Bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[var(--border-subtle)] bg-white p-3 shadow-2xs">
          {/* Search box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="住所・物件名・最寄駅名で絞り込み..."
              className="w-full h-8.5 pl-9 pr-3 text-xs font-medium rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-600 focus:outline-none transition-all"
            />
          </div>

          {/* Min Yield Filter */}
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <span>最低利回り:</span>
            <select
              value={minYield}
              onChange={(e) => setMinYield(Number(e.target.value))}
              className="h-8.5 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 cursor-pointer focus:outline-none"
            >
              <option value="0">指定なし</option>
              <option value="5">5.0% 以上</option>
              <option value="6">6.0% 以上</option>
              <option value="7">7.0% 以上</option>
              <option value="8">8.0% 以上 (高利回り)</option>
              <option value="10">10.0% 以上</option>
            </select>
          </div>

          {/* Max Price Filter */}
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <span>価格上限:</span>
            <select
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="h-8.5 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 cursor-pointer focus:outline-none"
            >
              <option value="0">上限なし</option>
              <option value="5000">〜5,000万円</option>
              <option value="10000">〜1億円</option>
              <option value="20000">〜2億円</option>
              <option value="30000">〜3億円</option>
              <option value="50000">〜5億円</option>
            </select>
          </div>

          {/* Structure Filter */}
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
            <span>構造:</span>
            <select
              value={selectedStructure}
              onChange={(e) => setSelectedStructure(e.target.value)}
              className="h-8.5 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-800 cursor-pointer focus:outline-none"
            >
              <option value="all">すべての構造</option>
              <option value="RC">RC (鉄筋コンクリート)</option>
              <option value="SRC">SRC (鉄骨鉄筋コンクリート)</option>
              <option value="S">鉄骨造 (S)</option>
              <option value="木造">木造</option>
            </select>
          </div>
        </div>

        {/* Map Container (Expands to fill 100% of remaining vertical height) */}
        <div className="flex-1 min-h-0 relative">
          <TokyoPropertyMap
            listings={mapListings}
            selectedListingId={selectedListing?._id || selectedListing?.id}
            onSelectListing={(l) => setSelectedListing(l)}
            onViewInList={(l) => {
              const id = l._id || l.id;
              if (id) {
                navigate(`/orders?focusListing=${id}`);
              }
            }}
            height="100%"
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
}
