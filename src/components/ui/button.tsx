import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

const variantStyles: Record<string, string> = {
  default:
    "bg-[var(--brand)] text-white shadow-sm hover:bg-[var(--brand-hover)] hover:shadow-md active:scale-[0.98]",
  outline:
    "border border-[var(--border-default)] bg-white text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] hover:border-[var(--border-strong)] active:scale-[0.98]",
  ghost:
    "text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] hover:text-[var(--text-primary)] active:scale-[0.98]",
  destructive:
    "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98]",
  secondary:
    "bg-[var(--bg-surface-hover)] text-[var(--text-primary)] hover:bg-[#eaeeea] active:scale-[0.98]",
  link:
    "text-[var(--brand)] underline-offset-4 hover:underline",
};

const sizeStyles: Record<string, string> = {
  default: "h-10 px-4 py-2 rounded-xl text-sm",
  sm: "h-8 px-3 rounded-lg text-xs",
  lg: "h-12 px-6 rounded-xl text-base",
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
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-bold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 cursor-pointer select-none",
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