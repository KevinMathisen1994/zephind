import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
/** 万円 amount as Japanese price text: 39700 -> "3億9,700万", 40000 -> "4億", 8500 -> "8,500万". Caller appends 円. */
export function formatMan(man: number): string {
  if (Math.abs(man) < 10000) return `${man.toLocaleString()}万`;
  const oku = Math.trunc(man / 10000);
  const rest = Math.round((man - oku * 10000) * 100) / 100;
  return rest ? `${oku}億${Math.abs(rest).toLocaleString()}万` : `${oku}億`;
}
