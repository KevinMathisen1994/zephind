import type { ReactNode, LabelHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Label({ children, className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement> & { children: ReactNode }) {
  return (
    <label
      className={cn("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    >
      {children}
    </label>
  );
}