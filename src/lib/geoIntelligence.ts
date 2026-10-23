/**
 * Tokyo Geospatial Intelligence Database & Coordinate Resolver
 * Provides coordinates, hazard overlays, station hubs, and yield heat models.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface StationHub {
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}

export interface HazardZone {
  name: string;
  type: "flood" | "liquefaction" | "plateau_safe";
  label: string;
  description: string;
  severity: "high" | "medium" | "low" | "safe";
  center: GeoPoint;
  radiusMeters: number;
}

export const TOKYO_WARD_COORDINATES: Record<string, GeoPoint> = {
  千代田区: { lat: 35.694, lng: 139.7536 },
  中央区: { lat: 35.6707, lng: 139.7719 },
  港区: { lat: 35.658, lng: 139.7514 },
  新宿区: { lat: 35.6938, lng: 139.7034 },
  文京区: { lat: 35.7078, lng: 139.7523 },
  台東区: { lat: 35.7126, lng: 139.7799 },
  墨田区: { lat: 35.7107, lng: 139.8165 },
  江東区: { lat: 35.6729, lng: 139.8174 },
  品川区: { lat: 35.6092, lng: 139.7303 },
  目黒区: { lat: 35.6415, lng: 139.6982 },
  大田区: { lat: 35.5614, lng: 139.7161 },
  世田谷区: { lat: 35.6466, lng: 139.6533 },
  渋谷区: { lat: 35.662, lng: 139.7038 },
  中野区: { lat: 35.7075, lng: 139.6638 },
  杉並区: { lat: 35.6995, lng: 139.6364 },
  豊島区: { lat: 35.7289, lng: 139.719 },
  北区: { lat: 35.7528, lng: 139.734 },
  荒川区: { lat: 35.7359, lng: 139.7834 },
  板橋区: { lat: 35.7512, lng: 139.7088 },
  練馬区: { lat: 35.7356, lng: 139.6519 },
  足立区: { lat: 35.775, lng: 139.8044 },
  葛飾区: { lat: 35.7434, lng: 139.8472 },
  江戸川区: { lat: 35.6906, lng: 139.8784 },
  // All 26 Cities of Tokyo (多摩市部)
  武蔵野市: { lat: 35.7176, lng: 139.5661 },
  三鷹市: { lat: 35.6834, lng: 139.5594 },
  調布市: { lat: 35.6519, lng: 139.5441 },
  府中市: { lat: 35.6702, lng: 139.4777 },
  立川市: { lat: 35.6995, lng: 139.4137 },
  八王子市: { lat: 35.6554, lng: 139.3389 },
  町田市: { lat: 35.5467, lng: 139.4386 },
  小金井市: { lat: 35.6994, lng: 139.5032 },
  小平市: { lat: 35.7313, lng: 139.4891 },
  国分寺市: { lat: 35.7118, lng: 139.4800 },
  国立市: { lat: 35.6841, lng: 139.4414 },
  西東京市: { lat: 35.7270, lng: 139.5380 },
  日野市: { lat: 35.6713, lng: 139.3951 },
  東村山市: { lat: 35.7548, lng: 139.4687 },
  多摩市: { lat: 35.6370, lng: 139.4463 },
  稲城市: { lat: 35.6377, lng: 139.5050 },
  狛江市: { lat: 35.6321, lng: 139.5786 },
  昭島市: { lat: 35.7061, lng: 139.3547 },
  東大和市: { lat: 35.7454, lng: 139.4265 },
  清瀬市: { lat: 35.7854, lng: 139.5262 },
  東久留米市: { lat: 35.7583, lng: 139.5338 },
  武蔵村山市: { lat: 35.7542, lng: 139.3871 },
  青梅市: { lat: 35.7879, lng: 139.2759 },
  福生市: { lat: 35.7388, lng: 139.3276 },
  羽村市: { lat: 35.7675, lng: 139.3117 },
  あきる野市: { lat: 35.7289, lng: 139.2941 },
};

export const TOKYO_MAJOR_STATIONS: StationHub[] = [
  // Western Tokyo & JR Chuo Line
  { name: "国立駅", lat: 35.6993, lng: 139.4462, lines: ["JR中央線"] },
  { name: "国分寺駅", lat: 35.7003, lng: 139.4802, lines: ["JR中央線", "西武国分寺線", "西武多摩湖線"] },
  { name: "西国分寺駅", lat: 35.6997, lng: 139.4659, lines: ["JR中央線", "武蔵野線"] },
  { name: "武蔵小金井駅", lat: 35.7010, lng: 139.5064, lines: ["JR中央線"] },
  { name: "東小金井駅", lat: 35.7016, lng: 139.5241, lines: ["JR中央線"] },
  { name: "武蔵境駅", lat: 35.7021, lng: 139.5448, lines: ["JR中央線", "西武多摩川線"] },
  { name: "三鷹駅", lat: 35.7027, lng: 139.5606, lines: ["JR中央線", "総武線"] },
  { name: "吉祥寺駅", lat: 35.7031, lng: 139.5798, lines: ["JR中央線", "井の頭線"] },
  { name: "西荻窪駅", lat: 35.7038, lng: 139.5996, lines: ["JR中央線", "総武線"] },
  { name: "荻窪駅", lat: 35.7045, lng: 139.6200, lines: ["JR中央線", "丸ノ内線"] },
  { name: "阿佐ケ谷駅", lat: 35.7048, lng: 139.6358, lines: ["JR中央線", "総武線"] },
  { name: "高円寺駅", lat: 35.7053, lng: 139.6497, lines: ["JR中央線", "総武線"] },
  { name: "中野駅", lat: 35.7058, lng: 139.6658, lines: ["JR中央線", "東西線"] },
  { name: "立川駅", lat: 35.6980, lng: 139.4137, lines: ["JR中央線", "南武線", "青梅線"] },
  { name: "八王子駅", lat: 35.6554, lng: 139.3389, lines: ["JR中央線", "横浜線", "八高線"] },
  { name: "調布駅", lat: 35.6521, lng: 139.5435, lines: ["京王線", "相模原線"] },
  { name: "府中駅", lat: 35.6721, lng: 139.4803, lines: ["京王線"] },
  { name: "町田駅", lat: 35.5420, lng: 139.4455, lines: ["JR横浜線", "小田急線"] },

  // Central Hubs
  { name: "渋谷駅", lat: 35.658, lng: 139.7016, lines: ["JR山手線", "半蔵門線", "銀座線", "東横線", "田園都市線"] },
  { name: "新宿駅", lat: 35.6896, lng: 139.7006, lines: ["JR山手線", "中央線", "丸ノ内線", "小田急線", "京王線"] },
  { name: "東京駅", lat: 35.6812, lng: 139.7671, lines: ["新幹線", "JR山手線", "中央線", "丸ノ内線"] },
  { name: "品川駅", lat: 35.6285, lng: 139.7388, lines: ["東海道新幹線", "JR山手線", "京急線"] },
  { name: "池袋駅", lat: 35.7295, lng: 139.7109, lines: ["JR山手線", "丸ノ内線", "有楽町線", "副都心線", "西武池袋線"] },
  { name: "目黒駅", lat: 35.6339, lng: 139.7158, lines: ["JR山手線", "目黒線", "南北線", "三田線"] },
  { name: "恵比寿駅", lat: 35.6467, lng: 139.7101, lines: ["JR山手線", "埼京線", "日比谷線"] },
  { name: "六本木駅", lat: 35.6628, lng: 139.7314, lines: ["日比谷線", "大江戸線"] },
  { name: "中目黒駅", lat: 35.6443, lng: 139.6991, lines: ["東横線", "日比谷線"] },
  { name: "表参道駅", lat: 35.6652, lng: 139.7123, lines: ["銀座線", "千代田線", "半蔵門線"] },
  { name: "二子玉川駅", lat: 35.6115, lng: 139.6268, lines: ["東急田園都市線", "大井町線"] },
  { name: "自由が丘駅", lat: 35.6074, lng: 139.6687, lines: ["東急東横線", "大井町線"] },

  // Eastern & Northern Hubs
  { name: "秋葉原駅", lat: 35.6983, lng: 139.7731, lines: ["JR山手線", "総武線", "日比谷線", "TX"] },
  { name: "上野駅", lat: 35.7141, lng: 139.7774, lines: ["新幹線", "JR山手線", "銀座線", "日比谷線"] },
  { name: "両国駅", lat: 35.6958, lng: 139.7928, lines: ["JR総武線", "都営大江戸線"] },
  { name: "錦糸町駅", lat: 35.6967, lng: 139.8143, lines: ["JR総武快速線", "半蔵門線"] },
  { name: "北千住駅", lat: 35.7495, lng: 139.8050, lines: ["JR常磐線", "日比谷線", "千代田線", "東武線", "TX"] },
  { name: "赤羽駅", lat: 35.7777, lng: 139.7209, lines: ["JR京浜東北線", "埼京線", "宇都宮線", "高崎線"] },
  { name: "豊洲駅", lat: 35.6550, lng: 139.7966, lines: ["有楽町線", "ゆりかもめ"] },
];

/** Tokyo Hazard & Geotechnical Overlays */
export const TOKYO_HAZARD_ZONES: HazardZone[] = [
  // Eastern Tokyo Lowlands (Arakawa / Edogawa / Sumida / Ryogoku)
  {
    name: "墨田・江東・両国・錦糸町 ゼロメートル低地浸水想定区域",
    type: "flood",
    label: "高浸水リスク地域 (3.0m〜5.0m想定)",
    description: "隅田川・荒川に挟まれた海抜ゼロメートル低地帯。堤防決壊時は広域水没が想定される警戒地域。",
    severity: "high",
    center: { lat: 35.698, lng: 139.805 },
    radiusMeters: 4500,
  },
  // 1. Tama River flood hazard zones (including Chofu / Fuchu / Inagi / Komae)
  {
    name: "多摩川中流・調布/府中/狛江/稲城 氾濫浸水想定区域",
    type: "flood",
    label: "河川氾濫警戒区域 (1.0m〜3.0m想定)",
    description: "多摩川氾濫時の浸水想定域（府中競馬場南側・調布多摩川沿い・是政低地）。2019年台風実績エリア。",
    severity: "high",
    center: { lat: 35.648, lng: 139.525 },
    radiusMeters: 3800,
  },
  {
    name: "多摩川・二子玉川・世田谷水害リスク域",
    type: "flood",
    label: "河川氾濫警戒区域 (0.5m〜2.0m)",
    description: "多摩川・野川合流地点周辺の低地。越水・内水氾濫対策の確認が推奨。",
    severity: "medium",
    center: { lat: 35.612, lng: 139.625 },
    radiusMeters: 2800,
  },
  {
    name: "多摩川下流・大田区沿岸氾濫想定域",
    type: "flood",
    label: "河川氾濫警戒区域 (0.5m〜2.0m)",
    description: "大田区南端・多摩川下流低地。堤防越水・高潮複合リスク警戒地域。",
    severity: "medium",
    center: { lat: 35.555, lng: 139.705 },
    radiusMeters: 2500,
  },
  // 2. East Tokyo Lowlands (Arakawa / Edogawa / Sumida)
  {
    name: "荒川・江東デルタ広域浸水想定区域",
    type: "flood",
    label: "高浸水リスク地域 (3.0m〜5.0m超想定)",
    description: "荒川・江戸川氾濫時に広域水没が想定されるゼロメートル低地帯。電気室上層階配置が必須。",
    severity: "high",
    center: { lat: 35.705, lng: 139.845 },
    radiusMeters: 4800,
  },
  {
    name: "隅田川・墨田墨東低地",
    type: "flood",
    label: "浸水リスク地域 (1.0m〜3.0m想定)",
    description: "海抜ゼロメートル地帯を含む隅田川東岸。杭基礎の深度と内水氾濫対策が推奨。",
    severity: "medium",
    center: { lat: 35.72, lng: 139.815 },
    radiusMeters: 3000,
  },
  // 3. Central Tokyo river valleys (Meguro / Shibuya / Kanda)
  {
    name: "目黒川低地浸水想定区域（中目黒・五反田）",
    type: "flood",
    label: "谷底低地・内水氾濫警戒 (0.5m〜1.5m)",
    description: "目黒川沿いの谷底低地。大雨時の内水氾濫リスクがあり、地下室・半地下住戸は要確認。",
    severity: "medium",
    center: { lat: 35.635, lng: 139.708 },
    radiusMeters: 2000,
  },
  {
    name: "渋谷川・古川流域（麻布十番・白金低地）",
    type: "flood",
    label: "谷底低地・浸水警戒 (0.5m〜1.5m)",
    description: "高台に囲まれた谷底低地。古川地下調節池が整備されているが浸水履歴あり。",
    severity: "medium",
    center: { lat: 35.652, lng: 139.734 },
    radiusMeters: 1800,
  },
  {
    name: "神田川・妙正寺川流域（落合・高田馬場）",
    type: "flood",
    label: "河川氾濫・内水警戒 (0.5m〜1.5m)",
    description: "新宿区・中野区境界付近の低地。環七地下調節池により軽減されているが要確認。",
    severity: "medium",
    center: { lat: 35.712, lng: 139.692 },
    radiusMeters: 2200,
  },
  // 4. Stable Musashino Diluvial Plateau (武蔵野台地)
  {
    name: "武蔵野台地・高台強固地盤（世田谷・杉並・練馬）",
    type: "plateau_safe",
    label: "強固な台地地盤（浸水リスク極小）",
    description: "洪積台地（関東ローム層）。支持層が浅く地震増幅率が低い最高評価地盤ゾーン。",
    severity: "safe",
    center: { lat: 35.665, lng: 139.635 },
    radiusMeters: 6000,
  },
  {
    name: "武蔵野台地・文京山手台地（本郷・小石川）",
    type: "plateau_safe",
    label: "強固な台地地盤（歴史的高台邸宅地）",
    description: "歴史的な高台山手エリア。液状化・浸水耐性が都内最高峰。",
    severity: "safe",
    center: { lat: 35.718, lng: 139.748 },
    radiusMeters: 3000,
  },
  // 5. Tokyo Bay Reclaimed Land Liquefaction Check
  {
    name: "東京湾岸埋立地・液状化事前検証推奨",
    type: "liquefaction",
    label: "埋立地・液状化警戒ゾーン",
    description: "湾岸エリア（豊洲・有明・東雲・台場）。タワーマンションは制震免震と地盤改良が一般的。",
    severity: "medium",
    center: { lat: 35.635, lng: 139.79 },
    radiusMeters: 3500,
  },
];

/** Simple deterministic string hash to generate micro-offsets */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Deterministically resolves a coordinate for any listing.
 * If the listing lacks lat/lng, matches its station or ward and adds a consistent micro-offset
 * so markers for different properties don't obscure each other.
 */
export function resolveListingCoordinates(listing: {
  _id?: string;
  id?: string;
  latitude?: number;
  longitude?: number;
  station?: string;
  stationName?: string;
  ward?: string;
  address?: string;
  title?: string;
}): GeoPoint {
  // 1. Direct valid coordinates
  if (
    typeof listing.latitude === "number" &&
    !isNaN(listing.latitude) &&
    listing.latitude > 30 &&
    listing.latitude < 45 &&
    typeof listing.longitude === "number" &&
    !isNaN(listing.longitude) &&
    listing.longitude > 130 &&
    listing.longitude < 150
  ) {
    return { lat: listing.latitude, lng: listing.longitude };
  }

  const seed = (listing._id || listing.id || "") + (listing.address || listing.title || "z");
  const h1 = Math.abs(hashString(seed));
  const h2 = Math.abs(hashString(seed + "lat"));

  // 2D polar dispersion across ward neighborhoods (~1.8km to 2.8km natural fan)
  const angle = ((h1 % 3600) / 3600) * 2 * Math.PI;
  const dist = (0.25 + 0.75 * Math.sqrt((h2 % 1000) / 1000)) * 0.022;
  const offsetLat = dist * Math.cos(angle);
  const offsetLng = dist * Math.sin(angle) * 1.25;

  // 2. Station match
  const stationStr = listing.stationName || listing.station || "";
  if (stationStr) {
    const stationMatch = TOKYO_MAJOR_STATIONS.find(
      (s) => stationStr.includes(s.name.replace("駅", "")) || s.name.includes(stationStr.replace("駅", "")),
    );
    if (stationMatch) {
      return {
        lat: stationMatch.lat + offsetLat * 0.5,
        lng: stationMatch.lng + offsetLng * 0.5,
      };
    }
  }

  // 3. Ward match
  const wardKey =
    listing.ward ||
    Object.keys(TOKYO_WARD_COORDINATES).find(
      (w) => listing.address?.includes(w) || listing.title?.includes(w),
    );

  if (wardKey && TOKYO_WARD_COORDINATES[wardKey]) {
    const base = TOKYO_WARD_COORDINATES[wardKey];
    return {
      lat: base.lat + offsetLat,
      lng: base.lng + offsetLng,
    };
  }

  // 4. Fallback to Tokyo center
  return {
    lat: 35.6812 + offsetLat * 1.5,
    lng: 139.7671 + offsetLng * 1.5,
  };
}

/** Calculate distance in meters between two coordinates via Haversine formula */
export function calculateDistanceMeters(p1: GeoPoint, p2: GeoPoint): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (p1.lat * Math.PI) / 180;
  const phi2 = (p2.lat * Math.PI) / 180;
  const deltaPhi = ((p2.lat - p1.lat) * Math.PI) / 180;
  const deltaLambda = ((p2.lng - p1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

export interface PropertyHazardAssessment {
  overallRisk: "safe" | "medium" | "high";
  riskLabel: string;
  riskDescription: string;
  groundType: string;
  groundDescription: string;
  matchingZones: {
    zone: HazardZone;
    distanceMeters: number;
    isInZone: boolean;
  }[];
  nearestStation?: StationHub & { distanceMeters: number };
}

/** Analyzes real-time flood, liquefaction, and diluvial ground risk for any property point */
export function assessPropertyHazard(
  point: GeoPoint,
  _ward?: string,
  _address?: string,
): PropertyHazardAssessment {
  const zoneDistances = TOKYO_HAZARD_ZONES.map((zone) => {
    const dist = calculateDistanceMeters(point, zone.center);
    return {
      zone,
      distanceMeters: Math.round(dist),
      isInZone: dist <= zone.radiusMeters,
    };
  });

  const activeZones = zoneDistances.filter((z) => z.isInZone);
  const highRisk = activeZones.find((z) => z.zone.severity === "high");
  const mediumRisk = activeZones.find((z) => z.zone.severity === "medium");
  const safeZone = activeZones.find((z) => z.zone.severity === "safe");

  // Closest station
  let nearestStation: (StationHub & { distanceMeters: number }) | undefined;
  let minStationDist = Infinity;
  for (const st of TOKYO_MAJOR_STATIONS) {
    const d = calculateDistanceMeters(point, st);
    if (d < minStationDist) {
      minStationDist = d;
      nearestStation = { ...st, distanceMeters: Math.round(d) };
    }
  }

  // Determine ground & risk
  let overallRisk: "safe" | "medium" | "high" = "safe";
  let riskLabel = "良好地盤・浸水低リスク";
  let riskDescription =
    "主要河川の浸水想定区域（多摩川・荒川・江東デルタ等）の外側に位置しており、浸水リスクは極小です。";
  let groundType = "武蔵野洪積台地 / 一般強固地盤";
  let groundDescription =
    "関東ローム層または強固な台地地盤。地震時の揺れ増幅率が低く、基礎杭の支持層も安定している傾向にあります。";

  if (highRisk) {
    overallRisk = "high";
    riskLabel = `${highRisk.zone.name}（高警戒）`;
    riskDescription = highRisk.zone.description;
    groundType = "沖積低地・河川堆積層";
    groundDescription =
      "軟弱粘土層や砂層が堆積している低地帯。大規模豪雨時の浸水対策、受変電設備や給排水ポンプの2階以上配置が推奨されます。";
  } else if (mediumRisk) {
    overallRisk = "medium";
    riskLabel = `${mediumRisk.zone.name}（要確認）`;
    riskDescription = mediumRisk.zone.description;
    groundType =
      mediumRisk.zone.type === "liquefaction"
        ? "東京湾岸埋立地 / 人工改変地"
        : "谷底低地 / 沖積層";
    groundDescription =
      mediumRisk.zone.type === "liquefaction"
        ? "埋立地特有の砂層。地盤改良履歴や支持杭が東京層まで到達しているかの構造計算書の事前確認が推奨されます。"
        : "高台に挟まれた谷底低地。大雨時の内水氾濫や地下・半地下住戸への雨水流入に留意が必要です。";
  } else if (safeZone) {
    overallRisk = "safe";
    riskLabel = "強固な台地地盤（浸水リスク極小）";
    riskDescription = safeZone.zone.description;
    groundType = "洪積台地（関東ローム層）";
    groundDescription =
      "地盤支持力が高く、水害リスクが極めて低い安定地盤です。長期的な資産価値の維持にも有利です。";
  }

  return {
    overallRisk,
    riskLabel,
    riskDescription,
    groundType,
    groundDescription,
    matchingZones: zoneDistances.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 4),
    nearestStation,
  };
}

