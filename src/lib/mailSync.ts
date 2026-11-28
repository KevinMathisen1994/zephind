type SyncResult = {
  provider: string;
  error?: string;
  synced?: number;
  listingsFound?: number;
  filteredOut?: number;
  alreadyProcessed?: number;
  messageErrors?: string[];
  done?: boolean;
  total?: number;
};
type SyncBatch = { results: SyncResult[]; nextOffset: number };
type SyncNow = (args: { fullSync: boolean; daysBack: number; offset: number }) => Promise<SyncBatch>;

/**
 * Runs a full mail sync. The server handles one small batch per call (edge function time limit),
 * so this loops and sums per account. Returns a per-mailbox summary line each.
 */
export async function runMailSync(
  syncNow: SyncNow,
  onProgress: (text: string) => void,
): Promise<{ text: string; failed: boolean }> {
  const totals = new Map<string, SyncResult>();
  let offset = 0;
  for (;;) {
    const batch = await syncNow({ fullSync: true, daysBack: 90, offset });
    for (const r of batch.results) {
      const t = totals.get(r.provider);
      totals.set(
        r.provider,
        t
          ? {
              ...r,
              error: r.error ?? t.error,
              synced: (t.synced ?? 0) + (r.synced ?? 0),
              listingsFound: (t.listingsFound ?? 0) + (r.listingsFound ?? 0),
              filteredOut: (t.filteredOut ?? 0) + (r.filteredOut ?? 0),
              alreadyProcessed: (t.alreadyProcessed ?? 0) + (r.alreadyProcessed ?? 0),
              messageErrors: [...(t.messageErrors ?? []), ...(r.messageErrors ?? [])],
            }
          : r,
      );
    }
    if (batch.results.every((r) => r.done || r.error)) break;
    offset = batch.nextOffset;
    const total = Math.max(...batch.results.map((r) => r.total ?? 0));
    onProgress(`同期中… ${Math.min(offset, total)} / ${total}件`);
  }

  const results = [...totals.values()];
  // "0 listings" and "every message failed extraction" used to look identical, so counts and errors are spelled out.
  const lines = results.map((r) => {
    if (r.error === "REAUTH_REQUIRED") return `${r.provider}: 認証切れです。再接続してください。`;
    const parts = [`${r.provider}: メール${r.synced ?? 0}件を確認`];
    if ((r.listingsFound ?? 0) > 0) parts.push(`${r.listingsFound}件の物件情報を抽出`);
    if ((r.filteredOut ?? 0) > 0) parts.push(`${r.filteredOut}件を設定により除外`);
    if ((r.alreadyProcessed ?? 0) > 0) parts.push(`${r.alreadyProcessed}件は処理済み`);
    const errors = r.messageErrors ?? [];
    if (errors.length > 0) parts.push(`${errors.length}件でエラー: ${errors[0]}`);
    if ((r.synced ?? 0) > 0 && !r.listingsFound && !r.filteredOut && errors.length === 0) {
      parts.push("物件情報は見つかりませんでした");
    }
    return parts.join(" / ");
  });
  const failed = results.some((r) => r.error || (r.messageErrors?.length ?? 0) > 0);
  return { text: lines.join("\n"), failed };
}
