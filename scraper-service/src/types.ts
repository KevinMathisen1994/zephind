export interface PropertyListing {
  address: string;
  ward: string;
  price: number;
  area: number;
  landSize?: number;
  floorArea?: number;
  buildYear?: number;
  age?: string;
  source: string;
  url?: string;
  description?: string;
  rooms?: number;
  layout?: string;
  station?: string;
  walkMinutes?: number;
  buildingCoverageRatio?: number;
  floorAreaRatio?: number;
  roadWidth?: number;
  frontage?: number;
  propertyType?: string; // "土地" | "一戸建て" | "マンション" | etc
  // New fields for enhanced filtering
  yield?: number; // 利回り (%)
  totalUnits?: number; // 総戸数
  floor?: number; // 階数
  elevators?: number; // エレベーター数
  structureType?: string; // 構造 (RC, SRC, S, 木造, etc.)
  layoutType?: string; // 間取りタイプ (ファミリー, 1K, etc.)
}

export interface ScrapeResult {
  listings: PropertyListing[];
  source: string;
  areaCode: string;
  scrapedAt: number;
  count: number;
  /**
   * Errors caught during scraping, recorded rather than only logged.
   *
   * Several scrapers catch their own failures, log them, and return an empty
   * listing array — so a connection refusal or navigation timeout was
   * indistinguishable from "this ward genuinely has no inventory". The health
   * check then reported "selectors changed" for what was actually
   * ERR_CONNECTION_REFUSED, pointing at the wrong fix. Surface the real cause.
   */
  errors?: string[];
}

export interface OrderCriteria {
  ward?: string;
  wards?: string[]; // 複数区対応 (e.g., ["台東区", "中央区", "渋谷区"])
  priceMin?: number;
  priceMax?: number;
  walkMinutes?: number;
  minBuildingCoverageRatio?: number;
  minFloorAreaRatio?: number;
  propertyTypes?: string[];
  landSizeMin?: number;
  landSizeMax?: number;
  buildingSizeMin?: number;
  buildingSizeMax?: number;
  // New filter options
  maxBuildAge?: number; // 築年数以内 (e.g., 30 = 築30年以内)
  minBuildYear?: number; // 最低築年 (e.g., 2020 = 2020年以降)
  minYield?: number; // 最低利回り (%)
  maxYield?: number; // 最高利回り (%)
  minRoadWidth?: number; // 最低道路幅員 (m)
  minTotalUnits?: number; // 最低総戸数
  maxFloor?: number; // 最高階数
  excludeFirstFloor?: boolean; // 一階不可
  minElevators?: number; // 最低エレベーター数
  structureTypes?: string[]; // 構造種別 (RC, SRC, S, 木造)
  layoutTypes?: string[]; // 間取りタイプ (ファミリー, etc.)
}

export interface HardFilterResult {
  passed: PropertyListing[];
  failed: PropertyListing[];
  stats: {
    total: number;
    passed: number;
    failed: number;
    reasons: Record<string, number>;
  };
}

export interface ProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: string;
}