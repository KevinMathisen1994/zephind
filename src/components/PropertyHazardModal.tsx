import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  X,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  MapPin,
  ExternalLink,
  Layers,
  Train,
  Building2,
  Compass,
  ArrowUpRight,
  RotateCcw,
  Trash2,
  ChevronDown,
  ChevronUp,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import {
  resolveListingCoordinates,
  assessPropertyHazard,
  TOKYO_MAJOR_STATIONS,
  type GeoPoint,
} from "../lib/geoIntelligence";

export type DisasterType =
  | "flood"
  | "landslide"
  | "surge"
  | "tsunami"
  | "road"
  | "landform";

interface HazardLayerMeta {
  id: DisasterType;
  name: string;
  sublabel: string;
  urls: string[];
  maxZoom: number;
  minZoom: number;
  opacity: number;
  legend: { color: string; label: string }[];
}

export const MLIT_HAZARD_LAYERS: Record<DisasterType, HazardLayerMeta> = {
  flood: {
    id: "flood",
    name: "洪水・内水",
    sublabel: "想定最大規模",
    urls: [
      "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
    ],
    maxZoom: 17,
    minZoom: 2,
    opacity: 0.8,
    legend: [
      { color: "#ffffb3", label: "0.5m未満 (床下浸水)" },
      { color: "#fed976", label: "0.5m〜3.0m (1階床上)" },
      { color: "#feb24c", label: "3.0m〜5.0m (2階床上)" },
      { color: "#fd8d3c", label: "5.0m〜10.0m (3階以上)" },
      { color: "#bd0026", label: "10.0m〜20.0m (大規模水没)" },
    ],
  },
  landslide: {
    id: "landslide",
    name: "土砂災害",
    sublabel: "土石流・急傾斜地",
    urls: [
      "https://disaportaldata.gsi.go.jp/raster/05_dosekiryukeikaikuiki/{z}/{x}/{y}.png",
      "https://disaportaldata.gsi.go.jp/raster/05_kyukeishakeikaikuiki/{z}/{x}/{y}.png",
      "https://disaportaldata.gsi.go.jp/raster/05_jisuberikeikaikuiki_data/{z}/{x}/{y}.png",
    ],
    maxZoom: 17,
    minZoom: 2,
    opacity: 0.82,
    legend: [
      { color: "#fbbf24", label: "警戒区域 (イエローゾーン)" },
      { color: "#ef4444", label: "特別警戒区域 (レッドゾーン)" },
    ],
  },
  surge: {
    id: "surge",
    name: "高潮",
    sublabel: "想定最大規模",
    urls: [
      "https://disaportaldata.gsi.go.jp/raster/03_hightide_l2_shinsuishin_data/{z}/{x}/{y}.png",
    ],
    maxZoom: 17,
    minZoom: 2,
    opacity: 0.8,
    legend: [
      { color: "#ffffb3", label: "0.5m未満" },
      { color: "#fed976", label: "0.5m〜1.0m" },
      { color: "#feb24c", label: "1.0m〜3.0m" },
      { color: "#e11d48", label: "3.0m〜5.0m" },
      { color: "#881337", label: "5.0m以上" },
    ],
  },
  tsunami: {
    id: "tsunami",
    name: "津波",
    sublabel: "想定最大規模",
    urls: [
      "https://disaportaldata.gsi.go.jp/raster/04_tsunami_newlegend_data/{z}/{x}/{y}.png",
    ],
    maxZoom: 17,
    minZoom: 2,
    opacity: 0.8,
    legend: [
      { color: "#ffffb3", label: "0.3m〜1.0m" },
      { color: "#fed976", label: "1.0m〜3.0m" },
      { color: "#f87171", label: "3.0m〜5.0m" },
      { color: "#c084fc", label: "5.0m〜10.0m" },
      { color: "#581c87", label: "10.0m以上" },
    ],
  },
  road: {
    id: "road",
    name: "道路防災情報",
    sublabel: "道路冠水想定箇所",
    urls: [
      "https://disaportaldata.gsi.go.jp/raster/06_dosha_doro/{z}/{x}/{y}.png",
    ],
    maxZoom: 17,
    minZoom: 2,
    opacity: 0.85,
    legend: [
      { color: "#f59e0b", label: "道路冠水想定箇所" },
      { color: "#ef4444", label: "事前通行規制区間" },
    ],
  },
  landform: {
    id: "landform",
    name: "地形分類",
    sublabel: "治水地形分類図",
    urls: [
      "https://cyberjapandata.gsi.go.jp/xyz/lcmfc2/{z}/{x}/{y}.png",
    ],
    maxZoom: 16,
    minZoom: 10,
    opacity: 0.72,
    legend: [
      { color: "#86efac", label: "山地・丘陵地" },
      { color: "#fef08a", label: "台地・段丘（強固地盤）" },
      { color: "#93c5fd", label: "扇状地・自然堤防" },
      { color: "#38bdf8", label: "沖積低地・後背湿地" },
      { color: "#f472b6", label: "旧河道・水部" },
      { color: "#a8a29e", label: "人工盛土・干拓地" },
    ],
  },
};

interface PropertyHazardModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: any;
  /** Open the full map-analysis page centred on this property. */
  onOpenMapPage?: (listing: any) => void;
}

export function PropertyHazardModal({
  isOpen,
  onClose,
  listing,
  onOpenMapPage,
}: PropertyHazardModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const activeTileLayersRef = useRef<Map<string, L.TileLayer[]>>(new Map());

  // State for official MLIT hazard layer toggles (defaults to 'flood')
  const [activeLayers, setActiveLayers] = useState<Set<DisasterType>>(
    new Set(["flood"]),
  );
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [expandedLegends, setExpandedLegends] = useState<Set<DisasterType>>(
    new Set(["flood"]),
  );
  const [tileTheme, setTileTheme] = useState<"light" | "dark">("light");
  const [showSidebar, setShowSidebar] = useState(true);

  // Toggle disaster layer on/off
  const toggleLayer = (layerId: DisasterType) => {
    setActiveLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  const resetLayers = () => {
    setActiveLayers(new Set());
  };

  const toggleLegend = (layerId: DisasterType) => {
    setExpandedLegends((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
      }
      return next;
    });
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Coordinates and Hazard Assessment
  const coords: GeoPoint = listing
    ? resolveListingCoordinates(listing)
    : { lat: 35.6812, lng: 139.7671 };

  const assessment = listing
    ? assessPropertyHazard(coords, listing.ward, listing.address)
    : null;

  // 1. Initialize Base Leaflet Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current || !listing) return;

    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        activeTileLayersRef.current.clear();
      }

      const map = L.map(mapContainerRef.current, {
        center: [coords.lat, coords.lng],
        zoom: 15,
        zoomControl: true,
      });
      mapInstanceRef.current = map;

      // Base Tile: GSI Pale Map
      const baseTileUrl = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";
      const baseTileLayer = L.tileLayer(baseTileUrl, {
        maxZoom: 18,
        attribution:
          '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a> · <a href="https://disaportal.gsi.go.jp/" target="_blank">国土交通省ハザードマップ</a>',
      });
      baseTileLayer.addTo(map);

      // 500m (~6 min walk) & 1000m radius circles
      const walkRing500 = L.circle([coords.lat, coords.lng], {
        radius: 500,
        color: "#4f46e5",
        weight: 1.5,
        fillColor: "#4f46e5",
        fillOpacity: 0.04,
        dashArray: "4, 4",
      });
      walkRing500.bindTooltip("徒歩約6分圏 (500m)", { sticky: true });
      walkRing500.addTo(map);

      // Nearby train stations
      TOKYO_MAJOR_STATIONS.forEach((st) => {
        const dist = Math.hypot(st.lat - coords.lat, st.lng - coords.lng);
        if (dist < 0.035) {
          const stationIcon = L.divIcon({
            className: "station-icon",
            html: `<div style="background: rgba(15, 23, 42, 0.92); color: white; padding: 2px 7px; border-radius: 9999px; font-size: 9px; font-weight: 800; border: 1px solid rgba(255,255,255,0.25); white-space: nowrap; display: flex; align-items: center; gap: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.25);">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #fbbf24;"></span>
              <span>${st.name}</span>
            </div>`,
            iconSize: [60, 20],
            iconAnchor: [30, 10],
          });
          const stMarker = L.marker([st.lat, st.lng], { icon: stationIcon });
          stMarker.bindTooltip(`${st.name} (${st.lines.join(" · ")})`);
          stMarker.addTo(map);
        }
      });

      // Animated Property Pin in center
      const pinColor =
        assessment?.overallRisk === "high"
          ? "#ef4444"
          : assessment?.overallRisk === "medium"
            ? "#f59e0b"
            : "#10b981";

      const pinIcon = L.divIcon({
        className: "property-hazard-pin",
        html: `
          <div style="position: relative; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center;">
            <div style="position: absolute; width: 40px; height: 40px; border-radius: 50%; background: ${pinColor}; opacity: 0.4; animation: ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
            <div style="position: relative; width: 28px; height: 28px; border-radius: 50%; background: ${pinColor}; border: 3px solid white; box-shadow: 0 4px 14px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; color: white; font-weight: 900; font-size: 13px;">
              ★
            </div>
          </div>
        `,
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      });

      const propertyMarker = L.marker([coords.lat, coords.lng], {
        icon: pinIcon,
        zIndexOffset: 1000,
      });
      propertyMarker.bindPopup(
        `<div style="font-family: sans-serif; font-size: 12px; font-weight: 800; color: #0f172a; padding: 2px;">
          <div>${listing.address || listing.title || "対象物件"}</div>
          <div style="font-size: 11px; font-weight: 700; color: #16a34a; margin-top: 2px;">
            ${listing.price ? `¥${listing.price.toLocaleString()}万円` : ""}
            ${listing.yield ? ` · 利回り ${listing.yield}%` : ""}
          </div>
        </div>`,
      );
      propertyMarker.addTo(map);

      map.invalidateSize();
    }, 80);

    return () => {
      clearTimeout(timer);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        activeTileLayersRef.current.clear();
      }
    };
  }, [isOpen, coords.lat, coords.lng, listing]);

  // 2. Synchronize Active Official Hazard Raster Layers with Leaflet Map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const currentLayerMap = activeTileLayersRef.current;

    // Remove unselected layers
    currentLayerMap.forEach((tileLayers, layerId) => {
      if (!activeLayers.has(layerId as DisasterType)) {
        tileLayers.forEach((tl) => map.removeLayer(tl));
        currentLayerMap.delete(layerId);
      }
    });

    // Add newly selected layers
    activeLayers.forEach((layerId) => {
      if (!currentLayerMap.has(layerId)) {
        const config = MLIT_HAZARD_LAYERS[layerId];
        if (config) {
          const addedTiles: L.TileLayer[] = [];
          config.urls.forEach((url) => {
            const tl = L.tileLayer(url, {
              maxZoom: config.maxZoom,
              minZoom: config.minZoom,
              opacity: config.opacity,
            });
            tl.addTo(map);
            addedTiles.push(tl);
          });
          currentLayerMap.set(layerId, addedTiles);
        }
      }
    });
  }, [activeLayers]);

  // 3. Tile Theme (Dark / Light)
  useEffect(() => {
    const container = mapContainerRef.current;
    const tilePane = container?.querySelector(".leaflet-tile-pane") as HTMLElement;
    if (tilePane) {
      if (tileTheme === "dark") {
        tilePane.style.filter =
          "invert(92%) hue-rotate(185deg) brightness(85%) contrast(105%)";
      } else {
        tilePane.style.filter = "none";
      }
    }
  }, [tileTheme]);

  if (!isOpen || !listing) return null;

  // MLIT Official Hazard Map URL
  const mlitUrl = `https://disaportal.gsi.go.jp/maps/?ll=${coords.lat},${coords.lng}&z=16&base=pale&vs=c1j0l0u0t0h0z0`;
  const gmapsUrl = listing.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(listing.address)}`
    : `https://www.google.com/maps/@${coords.lat},${coords.lng},17z`;

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      {/* ── Substantially Enlarged Modal Card (1500px Max, 94vh) ── */}
      <div className="relative w-[96vw] max-w-[1550px] h-[94vh] max-h-[94vh] flex flex-col rounded-3xl bg-white shadow-2xl border border-slate-200/90 overflow-hidden">
        {/* ── Modal Header ── */}
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-[#fffdfa]">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl shadow-xs text-white ${
                assessment?.overallRisk === "high"
                  ? "bg-rose-600"
                  : assessment?.overallRisk === "medium"
                    ? "bg-amber-600"
                    : "bg-emerald-700"
              }`}
            >
              {assessment?.overallRisk === "high" ? (
                <ShieldAlert className="w-4 h-4" />
              ) : assessment?.overallRisk === "medium" ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-serif text-base sm:text-lg font-bold text-slate-900 line-clamp-1">
                  ハザードマップ・地盤災害リスク診断
                </h2>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-black border uppercase tracking-wider ${
                    assessment?.overallRisk === "high"
                      ? "bg-rose-50 text-rose-800 border-rose-200"
                      : assessment?.overallRisk === "medium"
                        ? "bg-amber-50 text-amber-900 border-amber-200"
                        : "bg-emerald-50 text-emerald-800 border-emerald-200"
                  }`}
                >
                  {assessment?.overallRisk === "high"
                    ? "高浸水警戒"
                    : assessment?.overallRisk === "medium"
                      ? "浸水要確認"
                      : "良好安全地盤"}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-700">
                  {listing.address || listing.title || "所在地"}
                </span>
                {listing.ward && (
                  <span className="text-slate-400">({listing.ward})</span>
                )}
              </div>
            </div>
          </div>

          {/* Header Action Tools */}
          <div className="flex items-center gap-2">
            {/* Toggle Sidebar (Full Map vs Report) */}
            <button
              type="button"
              onClick={() => {
                setShowSidebar(!showSidebar);
                setTimeout(() => mapInstanceRef.current?.invalidateSize(), 160);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title={showSidebar ? "サイドバーを閉じて地図を最大化" : "診断レポートを表示"}
            >
              {showSidebar ? (
                <>
                  <PanelRightClose className="w-4 h-4 text-slate-500" />
                  <span className="hidden sm:inline">全画面マップ</span>
                </>
              ) : (
                <>
                  <PanelRightOpen className="w-4 h-4 text-emerald-600" />
                  <span className="hidden sm:inline">レポート表示</span>
                </>
              )}
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              title="閉じる (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ── Modal Body: Large Flex Layout ── */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative">
          {/* ── Map Viewport (Takes 100% of remaining width — massive 1100px+ display) ── */}
          <div className="flex-1 min-w-0 h-full relative overflow-hidden bg-slate-100">
            {/* ── Sleek Compact Floating Hazard Panel (w-[260px]) ── */}
            <div className="absolute top-3 left-3 z-[1050] w-[265px] pointer-events-auto">
              <div className="rounded-2xl bg-white/95 backdrop-blur-md border border-slate-300 shadow-xl overflow-hidden transition-all duration-200">
                {/* Panel Header */}
                <div
                  className="flex items-center justify-between px-3 py-2 bg-slate-50/90 border-b border-slate-200 cursor-pointer select-none hover:bg-slate-100 transition-colors"
                  onClick={() => setIsPanelExpanded(!isPanelExpanded)}
                  title={isPanelExpanded ? "折りたたむ" : "展開する"}
                >
                  <div className="flex items-center gap-1.5 text-xs font-black text-slate-800">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse"></span>
                    <span>選択中の情報</span>
                    <span className="text-[10px] font-bold text-slate-600 px-1.5 py-0.2 rounded-full bg-slate-200">
                      {activeLayers.size}件
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-400 hover:text-slate-700">
                    <span className="text-[10px] text-slate-400">
                      {isPanelExpanded ? "閉じる" : "表示"}
                    </span>
                    {isPanelExpanded ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </div>
                </div>

                {/* Collapsible Content */}
                {isPanelExpanded && (
                  <div className="p-2.5 space-y-2 max-h-[calc(90vh-180px)] overflow-y-auto">
                    {/* Subtitle */}
                    <div className="text-[10px] font-black text-blue-700 flex items-center gap-1 uppercase tracking-wider">
                      <span>⟳ 災害種別で選択</span>
                    </div>

                    {/* 6 Disaster Toggle Grid Buttons (Ultra-compact) */}
                    <div className="grid grid-cols-3 gap-1">
                      {(Object.keys(MLIT_HAZARD_LAYERS) as DisasterType[]).map((key) => {
                        const layer = MLIT_HAZARD_LAYERS[key];
                        const isActive = activeLayers.has(key);

                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => toggleLayer(key)}
                            className={`flex flex-col items-center justify-center p-1.5 rounded-xl border text-center transition-all cursor-pointer relative ${
                              isActive
                                ? "bg-blue-600 text-white border-blue-700 shadow-md ring-2 ring-blue-400/40"
                                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                            }`}
                            title={`${layer.name} (${layer.sublabel})`}
                          >
                            {/* Graphic Icon */}
                            <div className="w-5 h-5 mb-0.5 flex items-center justify-center font-black">
                              {key === "flood" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M2 10c3-3 6 3 9 0s6-3 9 0" />
                                  <path d="M2 15c3-3 6 3 9 0s6-3 9 0" />
                                  <path d="M2 20c3-3 6 3 9 0s6-3 9 0" />
                                </svg>
                              )}
                              {key === "landslide" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
                                  <circle cx="16" cy="14" r="1.5" fill="currentColor" />
                                  <circle cx="19" cy="17" r="1.5" fill="currentColor" />
                                </svg>
                              )}
                              {key === "surge" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M3 17c3-4 6 2 9-2s6-4 9 0" />
                                  <path d="M12 4v4m-4-2 4 4 4-4" />
                                </svg>
                              )}
                              {key === "tsunami" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M2 17c5-7 10-7 15-2 2 2 4 1 5-1" />
                                  <path d="M2 21c5-7 10-7 15-2 2 2 4 1 5-1" />
                                </svg>
                              )}
                              {key === "road" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <rect x="3" y="6" width="18" height="10" rx="2" />
                                  <circle cx="7" cy="18" r="2" />
                                  <circle cx="17" cy="18" r="2" />
                                  <path d="M2 14h20" />
                                </svg>
                              )}
                              {key === "landform" && (
                                <svg
                                  className="w-4 h-4"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <path d="M12 3 2 8l10 5 10-5-10-5Z" />
                                  <path d="m2 14 10 5 10-5" />
                                  <path d="m2 19 10 5 10-5" />
                                </svg>
                              )}
                            </div>

                            <div className="font-extrabold text-[9px] leading-tight">
                              {layer.name}
                            </div>
                            <div
                              className={`text-[8px] mt-0.5 leading-tight truncate max-w-full ${
                                isActive ? "text-blue-100" : "text-slate-400"
                              }`}
                            >
                              ({layer.sublabel.slice(0, 5)})
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Reset button */}
                    {activeLayers.size > 0 && (
                      <div className="pt-1 flex items-center justify-between border-t border-slate-100">
                        <button
                          type="button"
                          onClick={resetLayers}
                          className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>選択情報のリセット</span>
                        </button>
                      </div>
                    )}

                    {/* Active Layers Details & Legends */}
                    {activeLayers.size > 0 && (
                      <div className="space-y-1 pt-1 border-t border-slate-100">
                        {Array.from(activeLayers).map((key) => {
                          const layer = MLIT_HAZARD_LAYERS[key];
                          const isLegendOpen = expandedLegends.has(key);

                          return (
                            <div
                              key={key}
                              className="p-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs"
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 shrink-0"></span>
                                  <span className="font-bold text-slate-800 text-[10px] truncate">
                                    {layer.name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => toggleLegend(key)}
                                    className={`px-1 py-0.2 rounded text-[8px] font-bold border transition-colors ${
                                      isLegendOpen
                                        ? "bg-blue-600 text-white border-blue-600"
                                        : "bg-white text-blue-700 border-blue-300 hover:bg-blue-50"
                                    }`}
                                  >
                                    解説凡例
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => toggleLayer(key)}
                                    className="p-0.5 text-slate-400 hover:text-rose-600 transition-colors"
                                    title="解除"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </div>

                              {/* Color Swatch Legend */}
                              {isLegendOpen && (
                                <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 space-y-0.5">
                                  {layer.legend.map((item, idx) => (
                                    <div
                                      key={idx}
                                      className="flex items-center gap-1.5 text-[9px] text-slate-700"
                                    >
                                      <span
                                        className="w-2.5 h-2.5 rounded-xs shrink-0 border border-black/20"
                                        style={{ backgroundColor: item.color }}
                                      ></span>
                                      <span>{item.label}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Dark/Light toggle on top-right */}
            <div className="absolute top-3 right-3 z-[1050] pointer-events-auto">
              <button
                type="button"
                onClick={() =>
                  setTileTheme(tileTheme === "light" ? "dark" : "light")
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/95 backdrop-blur-md text-xs font-bold text-slate-700 border border-slate-200 shadow-sm hover:bg-white transition-all cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{tileTheme === "light" ? "ダーク地図" : "ライト地図"}</span>
              </button>
            </div>

            {/* Bottom Legend Pill */}
            <div className="absolute bottom-3 left-3 z-[1050] pointer-events-auto">
              <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-xl bg-white/95 backdrop-blur-md border border-slate-200 shadow-sm text-[11px] font-bold text-slate-700">
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full border border-indigo-500 border-dashed"></span>
                  <span>徒歩6分圏 (500m)</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                  <span>主要駅ハブ</span>
                </div>
              </div>
            </div>

            {/* Actual Leaflet Map DOM container */}
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          {/* ── Right Column: Hazard Intelligence Report Sidebar (Collapsible) ── */}
          {showSidebar && (
            <div className="w-full lg:w-96 shrink-0 h-full overflow-y-auto border-t lg:border-t-0 lg:border-l border-slate-200 p-5 space-y-4 bg-slate-50/50">
              {/* 1. Property Quick Highlights */}
              <div className="p-3.5 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-bold text-slate-400">物件価格</span>
                  <span className="text-lg font-black text-slate-900 font-data">
                    {listing.price
                      ? `¥${listing.price.toLocaleString()}万円`
                      : "価格応談"}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 pt-2 border-t border-slate-100">
                  <span className="font-medium flex items-center gap-1">
                    <Train className="w-3.5 h-3.5 text-slate-400" />
                    {listing.station || "最寄り駅"}
                    {listing.walkMinutes ? ` 徒歩${listing.walkMinutes}分` : ""}
                  </span>
                  {(listing.yield || listing.grossYield) && (
                    <span className="font-extrabold text-emerald-700 font-data">
                      利回り {(listing.yield || listing.grossYield).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>

              {/* 2. Primary Hazard & Flood Risk Assessment */}
              <div
                className={`p-4 rounded-2xl border shadow-2xs space-y-2 ${
                  assessment?.overallRisk === "high"
                    ? "bg-rose-50/70 border-rose-200"
                    : assessment?.overallRisk === "medium"
                      ? "bg-amber-50/70 border-amber-200"
                      : "bg-emerald-50/70 border-emerald-200"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      assessment?.overallRisk === "high"
                        ? "bg-rose-500 animate-pulse"
                        : assessment?.overallRisk === "medium"
                          ? "bg-amber-500 animate-pulse"
                          : "bg-emerald-600"
                    }`}
                  ></span>
                  <h3 className="font-bold text-sm text-slate-900">
                    {assessment?.riskLabel}
                  </h3>
                </div>
                <p className="text-xs leading-relaxed text-slate-700">
                  {assessment?.riskDescription}
                </p>
              </div>

              {/* 3. Ground Structure Analysis */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>推定地盤構造</span>
                </div>
                <div className="font-extrabold text-xs text-slate-900">
                  {assessment?.groundType}
                </div>
                <p className="text-[11px] leading-relaxed text-slate-600">
                  {assessment?.groundDescription}
                </p>
              </div>

              {/* 4. Action Buttons */}
              <div className="space-y-2 pt-2">
                {/* Official MLIT Overlay Hazard Map */}
                <a
                  href={mlitUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all shadow-xs cursor-pointer group"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                  <span>国土交通省 重ねるハザードマップ（公式）</span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-white transition-colors" />
                </a>

                <div className="grid grid-cols-2 gap-2">
                  {/* Google Maps link */}
                  <a
                    href={gmapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition-all shadow-2xs"
                  >
                    <span>Google Maps</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-400" />
                  </a>

                  {/* Full map page, centred on this property. The old label
                      said 「地図分割で比較」 but only scrolled the list and
                      flashed a border — it never opened any map. */}
                  {onOpenMapPage && (
                    <button
                      type="button"
                      onClick={() => onOpenMapPage(listing)}
                      title="地図分析ページでこの物件の位置と周辺を確認します"
                      className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition-all shadow-2xs cursor-pointer"
                    >
                      <Compass className="w-3.5 h-3.5 text-emerald-600" />
                      <span>地図分析で見る</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
