/**
 * Per-order 自動検索の頻度. The scheduled sweep runs at 03:30, 11:30 and 19:30 JST (scrape.yml);
 * each order says which of those it joins. Unset means every sweep, as before the setting existed.
 */
export type AutoScrape = "3" | "2" | "1" | "off";

/** Which sweep a run is (0: 03:30, 1: 11:30, 2: 19:30), from its start time; GitHub often starts cron runs late. */
export function sweepSlot(ms: number): 0 | 1 | 2 {
  const h = (new Date(ms).getUTCHours() + 9) % 24;
  if (h >= 2 && h < 10) return 0;
  if (h >= 10 && h < 18) return 1;
  return 2;
}

export function dueInSweep(setting: string | null | undefined, slot: 0 | 1 | 2): boolean {
  if (setting === "off") return false;
  if (setting === "1") return slot === 0; // morning, so the 新着物件レポート includes it
  if (setting === "2") return slot !== 1; // morning and evening
  return true;
}
