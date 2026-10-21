import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "destructive" | "brand" | "neutral" | "emerald" | "amber" | "blue";
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: "bg-[var(--brand)] text-white shadow-[0_1px_3px_rgba(22,101,3,0.2)]",
  secondary: "bg-[#edf1ed] text-[var(--text-primary)] border border-black/[0.04]",
  outline: "border border-[var(--border-default)] text-[var(--text-secondary)] bg-white/80 backdrop-blur-xs",
  destructive: "bg-red-50 text-red-700 border border-red-200",
  brand: "bg-[var(--brand-soft)] text-[#114e02] border border-[var(--brand-border)] shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)]",
  neutral: "bg-[#f2f4f2] text-[var(--text-secondary)] border border-transparent",
  emerald: "bg-emerald-50 text-emerald-800 border border-emerald-200/80",
  amber: "bg-amber-50 text-amber-800 border border-amber-200/80",
  blue: "bg-sky-50 text-sky-800 border border-sky-200/80",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-tight leading-normal select-none transition-colors",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}