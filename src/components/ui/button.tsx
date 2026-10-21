import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "link" | "glass";
  size?: "default" | "sm" | "lg" | "icon" | "pill";
}

const variantStyles: Record<string, string> = {
  default:
    "bg-[var(--brand)] text-white shadow-[0_2px_8px_rgba(22,101,3,0.2),inset_0_1px_1px_rgba(255,255,255,0.25)] hover:bg-[var(--brand-hover)] hover:shadow-[0_4px_16px_rgba(22,101,3,0.3)] active:scale-[0.98] border border-[rgba(255,255,255,0.12)]",
  outline:
    "border border-[var(--border-default)] bg-white text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.03),inset_0_1px_1px_rgba(255,255,255,0.8)] hover:bg-[var(--bg-surface-hover)] hover:border-[var(--border-strong)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.05)] active:scale-[0.98]",
  ghost:
    "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.98]",
  destructive:
    "bg-red-600 text-white shadow-[0_2px_8px_rgba(220,38,38,0.25),inset_0_1px_1px_rgba(255,255,255,0.2)] hover:bg-red-700 active:scale-[0.98]",
  secondary:
    "bg-[var(--bg-brand)] text-[var(--brand)] border border-[var(--brand-border)] hover:bg-[#e4efe0] active:scale-[0.98]",
  glass:
    "bg-white/80 backdrop-blur-md border border-white/60 text-[var(--text-primary)] shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:bg-white active:scale-[0.98]",
  link:
    "text-[var(--brand)] underline-offset-4 hover:underline",
};

const sizeStyles: Record<string, string> = {
  default: "h-10 px-4 py-2 rounded-xl text-sm",
  sm: "h-8 px-3 rounded-lg text-xs tracking-wide",
  lg: "h-12 px-6 rounded-2xl text-base tracking-tight font-bold",
  pill: "h-11 px-5 rounded-full text-sm font-bold",
  icon: "h-10 w-10 rounded-xl",
};

export function Button({
  children,
  variant = "default",
  size = "default",
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "group inline-flex items-center justify-center gap-2 whitespace-nowrap font-bold transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] focus-visible:outline-none focus-brand disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
        variantStyles[variant],
        sizeStyles[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}