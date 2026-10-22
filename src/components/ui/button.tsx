import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "link" | "glass";
  size?: "default" | "sm" | "lg" | "icon" | "pill";
}

const variantStyles: Record<string, string> = {
  default:
    "bg-[var(--brand)] text-white shadow-[0_1px_0_rgba(0,0,0,0.08)] hover:bg-[var(--brand-hover)] active:translate-y-px",
  outline:
    "border border-[var(--text-primary)]/25 bg-transparent text-[var(--text-primary)] hover:border-[var(--text-primary)]/50 hover:bg-[var(--bg-page-subtle)] active:translate-y-px",
  ghost:
    "text-[var(--text-secondary)] hover:bg-[var(--bg-page-subtle)] hover:text-[var(--text-primary)] active:translate-y-px",
  destructive:
    "bg-[var(--danger)] text-white hover:bg-[#931d17] active:translate-y-px",
  secondary:
    "border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-surface-hover)] active:translate-y-px",
  glass:
    "border border-[var(--border-default)] bg-[var(--bg-surface)]/90 text-[var(--text-primary)] hover:bg-[var(--bg-surface)] active:translate-y-px",
  link: "text-[var(--brand)] underline-offset-4 hover:underline",
};

const sizeStyles: Record<string, string> = {
  default: "h-10 px-4 rounded-lg text-sm",
  sm: "h-8 px-3 rounded-md text-xs",
  lg: "h-11 px-5 rounded-lg text-sm",
  pill: "h-9 px-4 rounded-full text-sm",
  icon: "h-8 w-8 rounded-md",
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
        "group inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap font-semibold tracking-[0.01em] transition-[background-color,border-color,color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)] disabled:pointer-events-none disabled:opacity-40",
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