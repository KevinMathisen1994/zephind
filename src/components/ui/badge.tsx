import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "destructive" | "brand" | "neutral" | "emerald" | "amber" | "blue";
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: "border-[var(--brand)] bg-[var(--brand)] text-white",
  secondary:
    "border-[var(--border-default)] bg-[var(--bg-page-subtle)] text-[var(--text-secondary)]",
  outline: "border-[var(--border-default)] bg-transparent text-[var(--text-secondary)]",
  destructive: "border-[#ecc9c5] bg-[var(--danger-soft)] text-[var(--danger)]",
  brand: "border-[var(--brand-border)] bg-[var(--brand-soft)] text-[var(--brand-ink)]",
  neutral: "border-[var(--border-subtle)] bg-transparent text-[var(--text-muted)]",
  emerald: "border-[#c3e2d3] bg-[var(--success-soft)] text-[var(--success)]",
  amber: "border-[#ecdcbd] bg-[var(--warning-soft)] text-[var(--warning)]",
  blue: "border-[#cdd6e6] bg-[var(--info-soft)] text-[var(--info)]",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex select-none items-center gap-1 rounded-[3px] border px-1.5 py-[3px] text-[9.5px] font-bold uppercase leading-none tracking-[0.1em] transition-colors",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}