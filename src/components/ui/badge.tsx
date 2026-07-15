import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "destructive";
  className?: string;
}

const variantStyles: Record<string, string> = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border border-border text-foreground",
  destructive: "bg-destructive text-destructive-foreground",
};

export function Badge({ children, variant = "default", className = "" }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 text-xs font-semibold transition-colors",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}