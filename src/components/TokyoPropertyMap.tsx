import React, { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  TOKYO_WARD_COORDINATES,
  TOKYO_MAJOR_STATIONS,
  TOKYO_HAZARD_ZONES,
  resolveListingCoordinates,
} from "../lib/geoIntelligence";
import {
  Layers,
  MapPin,
  Train,
  ShieldAlert,
  Maximize2,
  Minimize2,
  ExternalLink,
  FileText,
  Building2,
  X,
  Compass,
  Sparkles,
} from "lucide-react";

export interface MapListingItem {
  _id?: string;
  id?: string;
  title?: string;
  address?: string;
  ward?: string;
  price?: number;
  rent?: number;
  yield?: number;
  grossYield?: number;
  netYield?: number;
  station?: string;
  stationName?: string;
  walkMinutes?: number;
  walkingMinutes?: number;
  structure?: string;
  structureType?: string;
  area?: number;
  buildYear?: number;
  score?: number;
  images?: string[];
  url?: string;
  source?: string;
  latitude?: number;
  longitude?: number;
  dealType?: string;
}

interface TokyoPropertyMapProps {
  listings: MapListingItem[];
  selectedListingId?: string | null;
  onSelectListing?: (listing: MapListingItem) => void;
  onViewInList?: (listing: MapListingItem) => void;
  className?: string;
  height?: string;
}

export const TokyoPropertyMap: React.FC<TokyoPropertyMapProps> = ({
  listings,
  selectedListingId,
  onSelectListing,
  onViewInList,
  className = "",
  height = "600px",
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerRef = useRef<L.LayerGroup | null>(null);
  const hazardLayerRef = useRef<L.LayerGroup | null>(null);
  const stationsLayerRef = useRef<L.LayerGroup | null>(null);
  const isochronesLayerRef = useRef<L.LayerGroup | null>(null);

  // Layer toggles
  const [showHazard, setShowHazard] = useState(true);
  const [showIsochrones, setShowIsochrones] = useState(false);
  const [showStations, setShowStations] = useState(true);
  const [activeListing, setActiveListing] = useState<MapListingItem | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [displayMode, setDisplayMode] = useState<"price" | "yield" | "score">("price");
  const [selectedWard, setSelectedWard] = useState<string>("all");
  const [tileTheme, setTileTheme] = useState<"light" | "dark">("light");

  // Keep track of activeListing from props if passed
  useEffect(() => {
    if (selectedListingId) {
      const found = listings.find((l) => (l._id || l.id) === selectedListingId);
      if (found) {
        setActiveListing(found);
        const pt = resolveListingCoordinates(found);
        mapInstanceRef.current?.flyTo([pt.lat, pt.lng], 15, { duration: 0.8 });
      }
    }
  }, [selectedListingId, listings]);

  // Filter listings by ward if selected with density management
  const visibleListings = useMemo(() => {
    let list = listings;
    if (selectedWard !== "all") {
      list = listings.filter((l) => l.ward === selectedWard || l.address?.includes(selectedWard));
    }
    // If viewing all and there are many, prioritize high score/yield or top 100 so the map is crisp and uncrowded
    if (selectedWard === "all" && list.length > 100) {
      const top = [...list]
        .sort((a, b) => (b.score || b.yield || 0) - (a.score || a.yield || 0))
        .slice(0, 100);
      // The property we were asked to focus on must be on screen even when it
      // is not in the top 100 — otherwise the map flies to a point with no
      // marker and it looks like nothing happened.
      if (selectedListingId) {
        const focus = list.find(
          (l) => (l._id || l.id) === selectedListingId,
        );
        if (focus && !top.some((l) => (l._id || l.id) === selectedListingId)) {
          top.push(focus);
        }
      }
      return top;
    }
    return list;
  }, [listings, selectedWard, selectedListingId]);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [35.668, 139.73],
        zoom: 12,
        minZoom: 9,
        maxZoom: 18,
        zoomControl: false,
      });

      // Zoom control bottom-right
      L.control.zoom({ position: "bottomright" }).addTo(map);

      // Base Tile Layer (国土地理院 淡色地図 - Official Japanese Geospatial Pale Map, No API Key Required)
      const paleUrl = "https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png";

      L.tileLayer(paleUrl, {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>',
        maxZoom: 18,
      }).addTo(map);

      // Store layer groups
      markersLayerRef.current = L.layerGroup().addTo(map);
      hazardLayerRef.current = L.layerGroup().addTo(map);
      stationsLayerRef.current = L.layerGroup().addTo(map);
      isochronesLayerRef.current = L.layerGroup().addTo(map);

      mapInstanceRef.current = map;

      // Invalidate size after layout
      setTimeout(() => map.invalidateSize(), 200);

      return () => {
        map.remove();
        mapInstanceRef.current = null;
      };
    }
  }, []);

  // Update Tile Theme (using dark filter on tilePane so no external dark tile key is needed)
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const tilePane = mapInstanceRef.current.getPanes().tilePane;
    const container = mapInstanceRef.current.getContainer();
    if (tileTheme === "dark") {
      tilePane.style.filter = "invert(92%) hue-rotate(185deg) brightness(85%) contrast(105%)";
      container.style.backgroundColor = "#121815";
    } else {
      tilePane.style.filter = "none";
      container.style.backgroundColor = "#f6f3ec";
    }
  }, [tileTheme]);

  // Render Hazard Overlays
  useEffect(() => {
    if (!hazardLayerRef.current) return;
    hazardLayerRef.current.clearLayers();

    if (showHazard) {
      TOKYO_HAZARD_ZONES.forEach((zone) => {
        let color = "#ef4444";
        let fillColor = "#f87171";
        if (zone.severity === "safe") {
          color = "#059669";
          fillColor = "#34d399";
        } else if (zone.severity === "medium") {
          color = "#f59e0b";
          fillColor = "#fbbf24";
        }

        const circle = L.circle([zone.center.lat, zone.center.lng], {
          radius: zone.radiusMeters,
          color,
          weight: 1.5,
          opacity: 0.8,
          fillColor,
          fillOpacity: 0.16,
          dashArray: zone.severity === "safe" ? undefined : "6, 6",
        });

        circle.bindTooltip(
          `<div class="p-1 font-sans text-xs">
            <div class="font-bold text-slate-900">${zone.name}</div>
            <div class="text-[13.5px] text-slate-600 mt-0.5">${zone.label}</div>
            <div class="text-[12.5px] text-slate-500 mt-0.5">${zone.description}</div>
          </div>`,
          { sticky: true, opacity: 0.95 },
        );

        hazardLayerRef.current?.addLayer(circle);
      });

      // Also overlay official MLIT Flood Inundation Raster Tiles
      const mlitFloodTile = L.tileLayer(
        "https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png",
        {
          maxZoom: 17,
          minZoom: 2,
          opacity: 0.75,
        },
      );
      hazardLayerRef.current?.addLayer(mlitFloodTile);
    }
  }, [showHazard]);

  // Render Stations & Isochrones
  useEffect(() => {
    if (!stationsLayerRef.current || !isochronesLayerRef.current) return;
    stationsLayerRef.current.clearLayers();
    isochronesLayerRef.current.clearLayers();

    if (showStations) {
      TOKYO_MAJOR_STATIONS.forEach((station) => {
        const icon = L.divIcon({
          className: "custom-station-icon",
          html: `<div class="station-marker flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900/90 text-white shadow-md border border-white/20 backdrop-blur-xs text-[13.5px] font-bold">
            <span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
            <span>${station.name}</span>
          </div>`,
          iconSize: [80, 24],
          iconAnchor: [40, 12],
        });

        const marker = L.marker([station.lat, station.lng], { icon });
        marker.bindTooltip(
          `<div class="font-sans text-xs">
            <div class="font-bold">${station.name}</div>
            <div class="text-[13.5px] text-slate-500">${station.lines.join(" · ")}</div>
          </div>`,
          { direction: "top", offset: [0, -10] },
        );
        stationsLayerRef.current?.addLayer(marker);

        // Isochrones around major stations
        if (showIsochrones) {
          // 5 min walk (~400m)
          const iso5 = L.circle([station.lat, station.lng], {
            radius: 400,
            color: "#1a7100",
            weight: 1,
            fillColor: "#1a7100",
            fillOpacity: 0.08,
            dashArray: "4, 4",
          });
          // 10 min walk (~800m)
          const iso10 = L.circle([station.lat, station.lng], {
            radius: 800,
            color: "#0284c7",
            weight: 1,
            fillColor: "#0284c7",
            fillOpacity: 0.04,
            dashArray: "4, 4",
          });
          isochronesLayerRef.current?.addLayer(iso5);
          isochronesLayerRef.current?.addLayer(iso10);
        }
      });
    }
  }, [showStations, showIsochrones]);

  // Render Property Listing Markers
  useEffect(() => {
    if (!markersLayerRef.current || !mapInstanceRef.current) return;
    markersLayerRef.current.clearLayers();

    visibleListings.forEach((listing) => {
      const pt = resolveListingCoordinates(listing);
      const isSelected = (listing._id || listing.id) === (activeListing?._id || activeListing?.id);

      const effectiveYield = listing.yield || listing.grossYield || listing.netYield;
      const priceText = listing.price ? `¥${listing.price.toLocaleString()}万` : "価格応談";
      const yieldText = effectiveYield ? `${effectiveYield.toFixed(1)}%` : "—";
      const scoreText = listing.score ? `${Math.round(listing.score)}点` : "未評価";

      let displayText = priceText;
      if (displayMode === "yield") displayText = `利回 ${yieldText}`;
      if (displayMode === "score") displayText = `★ ${scoreText}`;

      const isHighYield = effectiveYield && effectiveYield >= 8.0;
      const isHighScore = listing.score && listing.score >= 80;

      const badgeColorClass = isSelected
        ? "bg-slate-950 text-white ring-2 ring-emerald-400 scale-110 shadow-lg z-30"
        : isHighScore || isHighYield
          ? "bg-emerald-700 text-white shadow-md hover:bg-emerald-800"
          : "bg-white text-slate-800 border border-slate-300 shadow-xs hover:border-slate-500";

      const markerHtml = `
        <div class="group relative flex items-center justify-center cursor-pointer transition-transform duration-150">
          <div class="px-2 py-0.5 rounded-full text-[13.5px] font-bold tracking-tight whitespace-nowrap flex items-center gap-1 ${badgeColorClass}">
            ${isHighScore ? '<span class="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse"></span>' : ""}
            <span>${displayText}</span>
          </div>
          ${
            isSelected
              ? '<span class="absolute -bottom-1 w-1.5 h-1.5 rotate-45 bg-slate-950"></span>'
              : ""
          }
        </div>
      `;

      const icon = L.divIcon({
        className: "custom-listing-pin",
        html: markerHtml,
        iconSize: [76, 22],
        iconAnchor: [38, 11],
      });

      const marker = L.marker([pt.lat, pt.lng], { icon, zIndexOffset: isSelected ? 1000 : 100 });

      // Immediate inline interactive popup on pin click
      const popupHtml = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; min-width: 180px; padding: 2px;">
          <div style="font-size: 10px; font-weight: 800; color: #166534; text-transform: uppercase; letter-spacing: 0.05em;">
            ${listing.ward || "東京都"} ${listing.structureType ? `· ${listing.structureType}` : ""}
          </div>
          <div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-top: 2px; line-height: 1.3;">
            ${listing.title || listing.address || "物件詳細"}
          </div>
          <div style="display: flex; gap: 8px; margin-top: 6px; padding: 6px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div>
              <div style="font-size: 9px; color: #64748b; font-weight: 700;">価格</div>
              <div style="font-size: 13px; font-weight: 900; color: #0f172a;">${listing.price ? `¥${listing.price.toLocaleString()}万` : "価格応談"}</div>
            </div>
            ${effectiveYield ? `
            <div>
              <div style="font-size: 9px; color: #64748b; font-weight: 700;">想定利回り</div>
              <div style="font-size: 13px; font-weight: 900; color: #15803d;">${effectiveYield.toFixed(2)}%</div>
            </div>` : ""}
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { offset: [0, -12], closeButton: false });

      marker.on("click", () => {
        setActiveListing(listing);
        onSelectListing?.(listing);
      });

      markersLayerRef.current?.addLayer(marker);
    });
  }, [visibleListings, activeListing, displayMode, onSelectListing]);

  // Handle fly to ward
  const handleWardChange = (ward: string) => {
    setSelectedWard(ward);
    if (ward === "all") {
      mapInstanceRef.current?.flyTo([35.668, 139.73], 12, { duration: 0.6 });
    } else if (TOKYO_WARD_COORDINATES[ward]) {
      const coord = TOKYO_WARD_COORDINATES[ward];
      mapInstanceRef.current?.flyTo([coord.lat, coord.lng], 14, { duration: 0.6 });
    }
  };

  const majorWards = ["all", "港区", "渋谷区", "新宿区", "中央区", "千代田区", "目黒区", "世田谷区", "品川区", "豊島区"];

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[#f8f6f0] shadow-sm transition-all duration-300 ${
        isFullscreen ? "fixed inset-0 z-50 rounded-none h-screen" : ""
      } ${className}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* ── Top Floating Glass Toolbar ── */}
      <div className="absolute top-3 inset-x-3 z-[1050] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Ward Filter Chips */}
        <div className="pointer-events-auto flex items-center gap-1 overflow-x-auto max-w-[calc(100%-160px)] p-1 rounded-full bg-white/90 backdrop-blur-md border border-black/[0.08] shadow-xs scrollbar-none">
          {majorWards.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => handleWardChange(w)}
              className={`px-3 py-1 rounded-full text-[14px] font-bold whitespace-nowrap transition-all cursor-pointer ${
                selectedWard === w
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {w === "all" ? "東京全域" : w}
            </button>
          ))}
        </div>

        {/* Display Mode & Fullscreen */}
        <div className="pointer-events-auto flex items-center gap-1.5 p-1 rounded-full bg-white/90 backdrop-blur-md border border-black/[0.08] shadow-xs">
          <div className="flex items-center bg-slate-100 rounded-full p-0.5">
            <button
              type="button"
              onClick={() => setDisplayMode("price")}
              className={`px-2 py-0.5 rounded-full text-[13.5px] font-bold transition-all ${
                displayMode === "price" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
              }`}
            >
              価格
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("yield")}
              className={`px-2 py-0.5 rounded-full text-[13.5px] font-bold transition-all ${
                displayMode === "yield" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
              }`}
            >
              利回り
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode("score")}
              className={`px-2 py-0.5 rounded-full text-[13.5px] font-bold transition-all ${
                displayMode === "score" ? "bg-white text-slate-900 shadow-2xs" : "text-slate-500"
              }`}
            >
              AIスコア
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "縮小" : "全画面表示"}
            className="p-1.5 rounded-full text-slate-600 hover:bg-slate-100 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* ── Left Geospatial Intel Layers Drawer / Pills ── */}
      <div className="absolute top-16 left-3 z-[1050] flex flex-col gap-1.5 pointer-events-auto">
        {/* Hazard Overlay Toggle */}
        <button
          type="button"
          onClick={() => setShowHazard(!showHazard)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs backdrop-blur-md border ${
            showHazard
              ? "bg-red-500 text-white border-red-600 ring-2 ring-red-400/30"
              : "bg-white/90 text-slate-700 border-black/[0.08] hover:bg-white"
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>ハザード水害マップ</span>
          {showHazard && <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>}
        </button>

        {/* Isochrones Walk Radius Toggle */}
        <button
          type="button"
          onClick={() => setShowIsochrones(!showIsochrones)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs backdrop-blur-md border ${
            showIsochrones
              ? "bg-emerald-600 text-white border-emerald-700 ring-2 ring-emerald-400/30"
              : "bg-white/90 text-slate-700 border-black/[0.08] hover:bg-white"
          }`}
        >
          <Compass className="w-3.5 h-3.5" />
          <span>駅徒歩圏 (5分・10分)</span>
        </button>

        {/* Major Stations Toggle */}
        <button
          type="button"
          onClick={() => setShowStations(!showStations)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-xs backdrop-blur-md border ${
            showStations
              ? "bg-slate-900 text-white border-slate-950"
              : "bg-white/90 text-slate-700 border-black/[0.08] hover:bg-white"
          }`}
        >
          <Train className="w-3.5 h-3.5" />
          <span>主要ハブ駅</span>
        </button>

        {/* Tile Theme Switcher */}
        <button
          type="button"
          onClick={() => setTileTheme(tileTheme === "light" ? "dark" : "light")}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold bg-white/90 text-slate-700 border border-black/[0.08] hover:bg-white shadow-xs backdrop-blur-md transition-all"
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{tileTheme === "light" ? "ダーク地図へ切替" : "ライト地図へ切替"}</span>
        </button>
      </div>

      {/* ── Active Property Preview Drawer (Double-Bezel Luxury Card) ── */}
      {activeListing && (
        <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-[1100] pointer-events-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Outer Shell (Doppelrand) */}
          <div className="p-1.5 rounded-[1.5rem] bg-black/10 backdrop-blur-xl border border-white/40 shadow-2xl">
            {/* Inner Core */}
            <div className="relative rounded-[calc(1.5rem-0.375rem)] bg-white p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.9)] space-y-3">
              {/* Close Button */}
              <button
                type="button"
                onClick={() => setActiveListing(null)}
                className="absolute top-3 right-3 p-1 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Title & Badge */}
              <div className="pr-6">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[13.5px] font-black text-slate-700">
                    {activeListing.ward || "東京都"}
                  </span>
                  {activeListing.structureType && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-[13.5px] font-black text-emerald-800">
                      {activeListing.structureType}
                    </span>
                  )}
                  {activeListing.score && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-50 text-[13.5px] font-black text-amber-800 flex items-center gap-0.5">
                      <Sparkles className="w-3 h-3 text-amber-500" />
                      {Math.round(activeListing.score)}点
                    </span>
                  )}
                </div>
                <h3 className="font-bold text-sm text-slate-900 line-clamp-1 leading-snug">
                  {activeListing.title || activeListing.address || "物件詳細"}
                </h3>
                <div className="flex items-center gap-1 text-xs text-slate-500 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{activeListing.address || "東京都内"}</span>
                </div>
              </div>

              {/* Price & Yield Highlights */}
              <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
                <div>
                  <div className="text-[13.5px] font-bold text-slate-400 uppercase tracking-wider">物件価格</div>
                  <div className="text-lg font-black text-slate-900 font-data">
                    {activeListing.price ? `¥${activeListing.price.toLocaleString()}万` : "価格応談"}
                  </div>
                </div>
                <div>
                  <div className="text-[13.5px] font-bold text-slate-400 uppercase tracking-wider">想定利回り</div>
                  <div className="text-lg font-black text-emerald-700 font-data">
                    {activeListing.yield || activeListing.grossYield
                      ? `${(activeListing.yield || activeListing.grossYield)?.toFixed(2)}%`
                      : "—"}
                  </div>
                </div>
              </div>

              {/* Station & Specs */}
              <div className="flex flex-wrap items-center gap-y-1 text-xs text-slate-600 gap-x-3">
                {(activeListing.station || activeListing.stationName) && (
                  <div className="flex items-center gap-1 font-medium">
                    <Train className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {activeListing.station || activeListing.stationName}
                      {activeListing.walkMinutes || activeListing.walkingMinutes
                        ? ` 徒歩${activeListing.walkMinutes || activeListing.walkingMinutes}分`
                        : ""}
                    </span>
                  </div>
                )}
                {activeListing.area && (
                  <div className="flex items-center gap-1 font-medium">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>建物 {activeListing.area}㎡</span>
                  </div>
                )}
                {activeListing.buildYear && (
                  <span className="text-slate-400">築{activeListing.buildYear}年</span>
                )}
              </div>

              {/* Action Buttons: Jump to List + Open Portal Source */}
              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                {onViewInList && (
                  <button
                    type="button"
                    onClick={() => onViewInList(activeListing)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all active:scale-[0.98] shadow-xs cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>一覧の物件へジャンプ</span>
                  </button>
                )}

                {activeListing.url && activeListing.source !== "email" ? (
                  <a
                    href={activeListing.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 text-slate-800 hover:bg-slate-50 text-xs font-bold transition-all shadow-2xs ${
                      !onViewInList ? "w-full" : ""
                    }`}
                    title="ポータル掲載ページを開く"
                  >
                    <span>{activeListing.source ? `${activeListing.source}で確認` : "元サイトを開く"}</span>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Map Count Legend Pill Bottom Left ── */}
      <div className="absolute bottom-3 left-3 z-[1050] pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/95 backdrop-blur-md border border-black/[0.08] shadow-xs text-xs font-bold text-slate-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>
            {selectedWard === "all" && listings.length > 100
              ? `注目物件: ${visibleListings.length}件 (全${listings.length}件中 · エリア選択で全件表示)`
              : `表示物件: ${visibleListings.length}件`}
          </span>
        </div>
      </div>

      {/* ── Actual Leaflet DOM Node ── */}
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};

export default TokyoPropertyMap;
