import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import { Plus } from "lucide-react";

export default function ProposalsPage() {
  const proposals = useQuery(api.proposals.list);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold">提案</h1>
          <p className="text-sm text-muted-foreground mt-1">
            物件取得提案と評価
          </p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          新規提案
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>提案ID</TableHead>
                <TableHead>物件</TableHead>
                <TableHead>スコア</TableHead>
                <TableHead>ステータス</TableHead>
                <TableHead>メモ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposals === undefined ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8">
                    読み込み中...
                  </TableCell>
                </TableRow>
              ) : proposals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    提案はまだありません。
                  </TableCell>
                </TableRow>
              ) : (
                proposals.map((proposal) => (
                  <TableRow key={proposal._id}>
                    <TableCell className="font-data text-xs">
                      {proposal._id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{proposal.propertyId || "—"}</TableCell>
                    <TableCell className="font-data">
                      {proposal.score ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          proposal.status === "approved"
                            ? "default"
                            : proposal.status === "pending"
                            ? "secondary"
                            : "outline"
                        }
                      >
                        {proposal.status === "approved" ? "承認済" : proposal.status === "pending" ? "保留中" : proposal.status || "保留中"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {proposal.notes || "—"}
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