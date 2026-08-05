import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "destructive" | "brand" | "neutral";
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: "bg-[var(--brand)] text-white",
  secondary: "bg-[var(--bg-surface-hover)] text-[var(--text-primary)]",
  outline: "border border-[var(--border-default)] text-[var(--text-secondary)]",
  destructive: "bg-destructive text-white",
  brand: "bg-[var(--brand-soft)] text-[#14532d] border border-[var(--brand-border)]",
  neutral: "bg-[#f1f3f1] text-[var(--text-secondary)]",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold leading-none",
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}