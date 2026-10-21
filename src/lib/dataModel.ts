/**
 * Row shapes for the tables the UI reads. Replaces
 * convex/_generated/dataModel.
 *
 * Every row carries `_id` and `_creationTime` because the Postgres schema keeps
 * those exact column names — see supabase/migrations/0001_init.sql for why.
 *
 * `Id<T>` is a plain string: Convex's branded ids gave compile-time table
 * safety that Postgres text ids cannot, so the parameter is kept only so
 * existing annotations still read as documentation.
 */
export type Id<_Table extends string = string> = string;

interface Row {
  _id: string;
  /** Epoch ms. */
  _creationTime: number;
}

export interface Listing extends Row {
  address?: string;
  ward?: string;
  price?: number;
  area?: number;
  landSize?: number;
  buildYear?: number;
  source?: string;
  status?: string;
  url?: string;
  description?: string;
  rooms?: number;
  layout?: string;
  station?: string;
  stationName?: string;
  walkMinutes?: number;
  walkingMinutes?: number;
  mlitBenchmark?: number;
  score?: number;
  latitude?: number;
  longitude?: number;
  title?: string;
  images?: string[];
  buildingCoverageRatio?: number;
  floorAreaRatio?: number;
  propertyType?: string;
  roadWidth?: number;
  frontage?: number;
  zoning?: string;
  pdfUrl?: string;
  yield?: number;
  structure?: string;
  structureType?: string;
  totalUnits?: number;
  /** 掲載日 as epoch ms, as published by the portal. */
  postedAt?: number;
  /** "posted" (first published) or "updated" (a re-post). */
  postedDateKind?: string;
  isNew?: boolean;
  /** "buy" or "rent". */
  dealType?: string;
  rent?: number;
  managementFee?: number;
  deposit?: number;
  keyMoney?: number;
  petsAllowed?: boolean;
  emailFrom?: string;
  emailReceivedAt?: number;
  emailSubject?: string;
  emailBody?: string;
  emailAttachments?: { id?: string; filename: string; mimeType: string; size: number }[];
}

export interface Order extends Row {
  name?: string;
  ward?: string;
  wards?: string[];
  dealType?: string;
  priceMin?: number;
  priceMax?: number;
  rentMin?: number;
  rentMax?: number;
  maxDeposit?: number;
  maxKeyMoney?: number;
  petsRequired?: boolean;
  areaMin?: number;
  areaMax?: number;
  status?: string;
  userId?: string;
  criteria?: Record<string, unknown> | null;
  walkMinutes?: number;
  minBuildingCoverageRatio?: number;
  minFloorAreaRatio?: number;
  propertyTypes?: string[];
  ownerChange?: boolean;
  landSizeMin?: number;
  landSizeMax?: number;
  buildingSizeMin?: number;
  buildingSizeMax?: number;
  maxBuildAge?: number;
  minBuildYear?: number;
  minYield?: number;
  maxYield?: number;
  minRoadWidth?: number;
  minTotalUnits?: number;
  maxFloor?: number;
  excludeFirstFloor?: boolean;
  minElevators?: number;
  structureTypes?: string[];
  layoutTypes?: string[];
  customerId?: string;
  isScraping?: boolean;
  scrapingStatus?: string;
  activeSource?: string;
  scrapeRunId?: number;
  lastScrapeAt?: number;
  lastScrapeBy?: string;
}

export interface Matching extends Row {
  userId?: string;
  orderId?: string;
  listingId?: string;
  score?: number;
  status?: string;
  evaluation?: string;
  scoreDetail?: Record<string, unknown> | null;
}

export interface Customer extends Row {
  userId?: string;
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
  notes?: string;
  createdAt?: number;
}

export interface Deal extends Row {
  userId?: string;
  title: string;
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  orderId?: string;
  orderName?: string;
  listings?: unknown;
  customMessage?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SavedListing extends Row {
  userId?: string;
  listingId?: string;
  orderId?: string;
  orderName?: string;
  note?: string;
  savedAt?: number;
  address?: string;
  ward?: string;
  price?: number;
  area?: number;
  landSize?: number;
  source?: string;
  url?: string;
  propertyType?: string;
  station?: string;
  walkMinutes?: number;
  score?: number;
  postedAt?: number;
  postedDateKind?: string;
}

export interface ScraperHealth extends Row {
  source: string;
  label?: string;
  /** "ok" | "degraded" | "broken" */
  status: string;
  listingCount?: number;
  durationMs?: number;
  areaCode?: string;
  checkedAt: number;
  issues?: string[];
  coverage?: unknown;
  sample?: unknown;
  error?: string;
}

export interface EmailSettings extends Row {
  userId?: string;
  signature?: string;
  updatedAt?: number;
}

interface TableMap {
  listings: Listing;
  orders: Order;
  matching: Matching;
  customers: Customer;
  deals: Deal;
  savedListings: SavedListing;
  scraperHealth: ScraperHealth;
  emailSettings: EmailSettings;
}

/** Doc<"orders"> etc., same spelling the Convex-generated type had. */
export type Doc<Table extends keyof TableMap> = TableMap[Table];
