import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-xl border border-[var(--border-default)] bg-white px-3.5 py-2 text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-all duration-150 focus:border-[var(--brand)] focus:shadow-[0_0_0_3px_rgba(26,113,0,0.1)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:bg-[var(--bg-surface-hover)]",
        className,
      )}
      {...props}
    />
  );
}