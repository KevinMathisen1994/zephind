import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 text-sm font-medium text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] transition-[border-color,box-shadow] duration-150 focus:border-[var(--text-primary)] focus:shadow-[0_0_0_3px_rgba(200,67,43,0.14)] focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--bg-page-subtle)] disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}