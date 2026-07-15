import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { wardLabelToCode } from "../lib/tokyoWards";
import { Play, RefreshCw, Database, Trash2 } from "lucide-react";

export default function AdminPage() {
  const [scrapeSource, setScrapeSource] = useState("athome");
  const [scrapeStatus, setScrapeStatus] = useState<string>("");
  const [isScraping, setIsScraping] = useState(false);
  const listings = useQuery(api.listings.list, {});
  const orders = useQuery(api.orders.list);
  const createListing = useMutation(api.listings.create);
  const createMatching = useMutation(api.matching.create);
  const deleteListing = useMutation(api.listings.remove);

  const targetWards = useMemo(() => {
    if (!orders) return [];
    const wardSet = new Set<string>();
    for (const o of orders) {
      if (o.ward) wardSet.add(o.ward);
    }
    return Array.from(wardSet).sort();
  }, [orders]);

  const targetCodes = useMemo(() => {
    return targetWards
      .map((label) => wardLabelToCode(label))
      .filter(Boolean) as string[];
  }, [targetWards]);

  const scraperUrl = import.meta.env.VITE_SCRAPER_URL as string;

  const handleScrape = async () => {
    setIsScraping(true);
    const codes = targetCodes.length > 0 ? targetCodes : ["13104"];
    setScrapeStatus(`スクレイピングを開始... 対象: ${codes.length}区`);

    // Build order criteria to send to scraper for server-side hard filtering
    const orderCriteria = (orders ?? [])
      .filter((o) => o.status === "pending" || o.status === "active")
      .map((o) => ({
        ward: o.ward || undefined,
        priceMin: o.priceMin || undefined,
        priceMax: o.priceMax || undefined,
        walkMinutes: o.walkMinutes ?? o.criteria?.walkMinutes ?? undefined,
        minBuildingCoverageRatio: o.minBuildingCoverageRatio ?? o.criteria?.minBuildingCoverageRatio ?? undefined,
        minFloorAreaRatio: o.minFloorAreaRatio ?? o.criteria?.minFloorAreaRatio ?? undefined,
      }))
      .filter((o) => Object.values(o).some((v) => v !== undefined));

    try {
      const res = await fetch(
        `${scraperUrl}/scrape?areaCodes=${codes.join(",")}&source=${scrapeSource}&orders=${encodeURIComponent(JSON.stringify(orderCriteria))}`
      );
      const data = await res.json();

      if (data.listings && Array.isArray(data.listings)) {
        let count = 0;
        for (const item of data.listings) {
          const listingId = await createListing({
            address: item.address || undefined,
            ward: item.ward || undefined,
            price: item.price ? Number(item.price) : undefined,
            area: item.area ? Number(item.area) : undefined,
            buildYear: item.buildYear ? Number(item.buildYear) : undefined,
            source: scrapeSource,
            status: "new",
            url: item.detailUrl || item.url || undefined,
            description: item.description || undefined,
            station: item.station || undefined,
            walkMinutes: item.walkMinutes ? Number(item.walkMinutes) : undefined,
            rooms: item.rooms ? Number(item.rooms) : undefined,
            layout: item.layout || undefined,
          });
          // Save match records for this listing against matched orders
          if (item.matchedOrderIndices && data.orderCriteria) {
            const activeOrders = (orders ?? []).filter((o) => o.status === "pending" || o.status === "active");
            for (const idx of item.matchedOrderIndices) {
              const matchedOrder = activeOrders[idx];
              if (matchedOrder) {
                await createMatching({
                  orderId: matchedOrder._id,
                  listingId: listingId,
                  status: "matched",
                });
              }
            }
          }
          count++;
        }
        const rejected = data.filterStats?.failed ?? 0;
        // Build match summary per order
        const activeOrders = (orders ?? []).filter((o) => o.status === "pending" || o.status === "active");
        const orderMatchCounts: Record<string, number> = {};
        for (const item of data.listings) {
          if (item.matchedOrderIndices && data.orderCriteria) {
            for (const idx of item.matchedOrderIndices) {
              const order = activeOrders[idx];
              if (order) {
                const name = order.name || order.ward || `Order#${idx}`;
                orderMatchCounts[name] = (orderMatchCounts[name] || 0) + 1;
              }
            }
          }
        }
        const matchSummary = Object.entries(orderMatchCounts)
          .map(([name, cnt]) => `${name}: ${cnt}件`)
　　　　　.join(" | ");
        setScrapeStatus(
          `スクレイピング完了！ ${count} 件を登録（${rejected} 件フィルター除外） — ${matchSummary}`
        );
      } else {
        setScrapeStatus(`スクレイピング完了。`);
      }
    } catch (err) {
      setScrapeStatus(`エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsScraping(false);
    }
  };

  const handleDeleteListing = async (id: string) => {
    await deleteListing({ id: id as any });
  };

  const manualListings = listings?.filter((l) => l.source === scrapeSource || l.source === "athome") ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">管理</h1>
        <p className="text-sm text-muted-foreground mt-1">
          システム管理とスクレイパーコントロール
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Play className="w-5 h-5" />
              手動スクレイパー
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>スキャン対象区</Label>
              <div className="flex flex-wrap gap-1.5 min-h-10 items-center">
                {targetWards.length === 0 ? (
                  <span className="text-sm text-muted-foreground">オーダーに区が指定されていません（デフォルト: 新宿区）</span>
                ) : (
                  targetWards.map((w) => (
                    <Badge key={w} variant="secondary">{w}</Badge>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>スクレイプ元</Label>
              <select
                className="flex h-10 w-full items-center justify-between border border-border bg-transparent px-3 py-2 text-sm appearance-none cursor-pointer"
                value={scrapeSource}
                onChange={(e) => setScrapeSource(e.target.value)}
              >
                <option value="athome">At Home</option>
                <option value="hatomark">Hatomark Site</option>
                <option value="kenbiya">Kenbiya</option>
                <option value="rakuten">楽天不動産</option>
                <option value="suumo">SUUMO</option>
                <option value="rengotai">Fudousan Rengotai</option>
              </select>
            </div>
            <Button
              onClick={handleScrape}
              disabled={isScraping}
              className="w-full gap-2"
            >
              {isScraping ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {isScraping ? "スクレイピング中..." : "スクレイピング実行"}
            </Button>
            {scrapeStatus && (
              <div
                className={`p-3 text-sm font-data ${
                  scrapeStatus.startsWith("エラー")
                    ? "bg-red-50 text-red-600"
                    : scrapeStatus.startsWith("スクレイピング完了")
                    ? "bg-green-50 text-green-700"
                    : "bg-muted"
                }`}
              >
                {scrapeStatus}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Database className="w-5 h-5" />
              システムステータス
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm">スクレイパーサービス</span>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-600" />
                <Badge variant="secondary">{scraperUrl ? "設定済み" : "未設定"}</Badge>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Convex バックエンド</span>
              <Badge variant="default">接続中</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">総リスティング数</span>
              <span className="font-data text-sm">
                {listings === undefined ? "..." : listings.length}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">Clerk 認証</span>
              <Badge variant="outline">有効</Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            {scrapeSource === "athome" ? "At Home" : 
             scrapeSource === "hatomark" ? "Hatomark Site" :
             scrapeSource === "kenbiya" ? "Kenbiya" :
             scrapeSource === "rakuten" ? "楽天不動産" :
             scrapeSource === "suumo" ? "SUUMO" :
             scrapeSource === "rengotai" ? "Fudousan Rengotai" : "スクレイプ"} リスティング
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>住所</TableHead>
                <TableHead>区</TableHead>
                <TableHead>価格 (万円)</TableHead>
                <TableHead>Area (m²)</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listings === undefined ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : manualListings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-base-content/60">
                    No scraped listings yet. Run a scrape above.
                  </TableCell>
                </TableRow>
              ) : (
                manualListings.slice(0, 20).map((listing) => (
                  <TableRow key={listing._id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {listing.address || "—"}
                    </TableCell>
                    <TableCell>{listing.ward || "—"}</TableCell>
                    <TableCell className="font-data">
                      {listing.price?.toLocaleString() || "—"}
                    </TableCell>
                    <TableCell className="font-data">
                      {listing.area?.toFixed(1) || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{listing.source || "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={listing.status === "new" ? "default" : "secondary"}>
                        {listing.status || "new"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => handleDeleteListing(listing._id)}
                        className="p-1 text-base-content/40 hover:text-red-500 transition-colors"
                        title="Delete listing"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}