// Per-site minimum gap between page loads (3-6s, jittered). homes, athome and
// kenbiya answer bursts with 405/429 challenges that look like "0 listings".
const lastHit = new Map<string, number>();

export async function pace(site: string, minMs = 3000, maxMs = 6000): Promise<void> {
  const gap = minMs + Math.random() * (maxMs - minMs);
  const wait = (lastHit.get(site) ?? 0) + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(site, Date.now());
}
