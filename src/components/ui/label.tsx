import type { ReactNode, LabelHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Label({ children, className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label
      className={cn("text-xs font-semibold leading-none tracking-[-0.005em] text-[var(--text-secondary)] peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    >
      {children}
    </label>
  );
}