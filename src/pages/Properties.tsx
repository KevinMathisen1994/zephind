import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { TOKYO_WARDS } from "../lib/tokyoWards";
import { Plus, X } from "lucide-react";

export default function PropertiesPage() {
  const properties = useQuery(api.properties.list);
  const createListing = useMutation(api.listings.create);
  const createProperty = useMutation(api.properties.create);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: "",
    address: "",
    ward: "",
    price: "",
    area: "",
    buildYear: "",
    station: "",
    walkMinutes: "",
    source: "manual",
    url: "",
    description: "",
  });
  const [registering, setRegistering] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    try {
      const listingId = await createListing({
        title: form.title || undefined,
        address: form.address || undefined,
        ward: form.ward || undefined,
        price: form.price ? Number(form.price) : undefined,
        area: form.area ? Number(form.area) : undefined,
        buildYear: form.buildYear ? Number(form.buildYear) : undefined,
        station: form.station || undefined,
        walkMinutes: form.walkMinutes ? Number(form.walkMinutes) : undefined,
        source: "manual",
        status: "new",
        url: form.url || undefined,
        description: form.description || undefined,
      });
      await createProperty({
        address: form.address || undefined,
        ward: form.ward || undefined,
        price: form.price ? Number(form.price) : undefined,
        area: form.area ? Number(form.area) : undefined,
        buildYear: form.buildYear ? Number(form.buildYear) : undefined,
        source: "manual",
        status: "pending",
        listingId: listingId,
      });
      setDone(true);
      setForm({
        title: "",
        address: "",
        ward: "",
        price: "",
        area: "",
        buildYear: "",
        station: "",
        walkMinutes: "",
        source: "manual",
        url: "",
        description: "",
      });
      setTimeout(() => setDone(false), 3000);
    } catch (err) {
      console.error("Failed to register property:", err);
    } finally {
      setRegistering(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">物件</h1>
          <p className="text-sm text-muted-foreground mt-1">
            物件データとベンチマーク情報
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "キャンセル" : "物件を登録"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">新規物件登録</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <Label>タイトル</Label>
                  <Input
                    placeholder="例: 港区六本木 商業用地 100㎡"
                    value={form.title}
                    onChange={(e) => updateField("title", e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>住所</Label>
                  <Input
                    placeholder="例: 東京都港区六本木1-1-1"
                    value={form.address}
                    onChange={(e) => updateField("address", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>区</Label>
                  <select
                    className="flex h-10 w-full items-center justify-between border border-border bg-transparent px-3 py-2 text-sm appearance-none cursor-pointer"
                    value={form.ward}
                    onChange={(e) => updateField("ward", e.target.value)}
                  >
                    <option value="">区を選択...</option>
                    {TOKYO_WARDS.map((w) => (
                      <option key={w.code} value={w.label}>
                        {w.label} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>価格 (万円)</Label>
                  <Input
                    type="number"
                    placeholder="例: 5000"
                    value={form.price}
                    onChange={(e) => updateField("price", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>土地面積 (m²)</Label>
                  <Input
                    type="number"
                    placeholder="例: 100"
                    value={form.area}
                    onChange={(e) => updateField("area", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>建築年</Label>
                  <Input
                    type="number"
                    placeholder="例: 2020"
                    value={form.buildYear}
                    onChange={(e) => updateField("buildYear", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>最寄駅</Label>
                  <Input
                    placeholder="例: 六本木駅"
                    value={form.station}
                    onChange={(e) => updateField("station", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>徒歩分数</Label>
                  <Input
                    type="number"
                    placeholder="例: 3"
                    value={form.walkMinutes}
                    onChange={(e) => updateField("walkMinutes", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>ソースURL</Label>
                  <Input
                    placeholder="https://..."
                    value={form.url}
                    onChange={(e) => updateField("url", e.target.value)}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>説明</Label>
                  <textarea
                    className="flex min-h-[80px] w-full border border-border bg-transparent px-3 py-2 text-sm resize-y"
                    placeholder="物件の説明..."
                    value={form.description}
                    onChange={(e) => updateField("description", e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={registering}>
                  {registering ? "登録中..." : "物件を登録"}
                </Button>
                {done && (
                  <span className="text-sm text-primary font-medium">
                    ✓ 物件を登録しました
                  </span>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>住所</TableHead>
                <TableHead>区</TableHead>
                <TableHead>価格 (万円)</TableHead>
                <TableHead>面積 (m²)</TableHead>
                <TableHead>単価/m²</TableHead>
                <TableHead>MLIT基準</TableHead>
                <TableHead>スコア</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {properties === undefined ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    読み込み中...
                  </TableCell>
                </TableRow>
              ) : properties.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    物件がまだありません。「物件を登録」から登録してください。
                  </TableCell>
                </TableRow>
              ) : (
                properties.map((prop) => (
                  <TableRow key={prop._id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {prop.address || "—"}
                    </TableCell>
                    <TableCell>{prop.ward || "—"}</TableCell>
                    <TableCell className="font-data">
                      {prop.price?.toLocaleString() || "—"}
                    </TableCell>
                    <TableCell className="font-data">
                      {prop.area?.toFixed(1) || "—"}
                    </TableCell>
                    <TableCell className="font-data">
                      {prop.price && prop.area
                        ? Math.round(prop.price / prop.area).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="font-data">
                      {prop.mlitBenchmark?.toLocaleString() || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          prop.score && prop.score >= 80
                            ? "default"
                            : prop.score && prop.score >= 50
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {prop.score ?? "—"}
                      </Badge>
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