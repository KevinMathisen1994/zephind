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
  title?: string; // 掲載タイトル。一棟/オーナーチェンジ判定の手掛かりになる
  /**
   * 掲載日 (epoch ms). From the list card where the portal prints one, otherwise
   * from the detail page — see services/postedDate.ts for which sites publish
   * what. Undefined means the portal does not expose it, NOT "posted long ago".
   */
  postedAt?: number;
  /** "posted" = 情報公開日/掲載日, "updated" = 更新日 (a re-post, not the original). */
  postedDateKind?: "posted" | "updated";
  /** The portal's own NEW / 新着 badge, for sites that show a badge but no date. */
  isNew?: boolean;

  /**
   * "rent" for a listing scraped off a site's 賃貸 (rental) vertical, "buy"
   * (or undefined, for every existing for-sale scraper) otherwise. Stamped by
   * the scraper itself, since it's the only thing that knows which vertical a
   * card came from — hardFilter gates a listing against an order's own
   * dealType using this field, not by guessing from which price-ish field is
   * populated.
   */
  dealType?: "buy" | "rent";
  /** Rental-only economics, additive to `price` (never a replacement for it). */
  rent?: number; // 賃料 (万円/月)
  managementFee?: number; // 管理費・共益費 (万円/月)
  deposit?: number; // 敷金 (万円 — absolute amount, not a month-multiple)
  keyMoney?: number; // 礼金 (万円 — absolute amount, not a month-multiple)
  petsAllowed?: boolean;

  // New fields for enhanced filtering
  yield?: number; // 利回り (%)
  totalUnits?: number; // 総戸数
  floor?: number; // 階数
  elevators?: number; // エレベーター数
  structure?: string; // 建物構造 (鉄筋コンクリート造, 木造, etc.)
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
  /** "buy" (default when absent — every order created before this existed) or
   *  "rent". An order is ONE or the other, never both. */
  dealType?: "buy" | "rent";
  priceMin?: number;
  priceMax?: number;
  rentMin?: number; // 賃料下限 (万円/月)
  rentMax?: number; // 賃料上限 (万円/月)
  maxDeposit?: number; // 敷金上限 (万円)
  maxKeyMoney?: number; // 礼金上限 (万円)
  petsRequired?: boolean; // ペット可のみ
  walkMinutes?: number;
  minBuildingCoverageRatio?: number;
  minFloorAreaRatio?: number;
  propertyTypes?: string[];
  /** オーナーチェンジ（賃貸中のまま売却される物件）のみを対象にする */
  ownerChange?: boolean;
  landSizeMin?: number;
  landSizeMax?: number;
  /** 専有面積 (マンション) / 建物面積。listing.area と比較する */
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