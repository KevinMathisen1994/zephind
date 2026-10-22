import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
  bezel?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] transition-colors duration-200 hover:border-[var(--border-strong)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-1 p-5 md:p-6", className)}>{children}</div>;
}

export function CardTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-lg font-bold tracking-tight text-[var(--text-primary)]", className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs font-medium leading-relaxed text-[var(--text-muted)]", className)}>{children}</p>;
}

export function CardContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5 md:p-6", className)}>{children}</div>;
}

export function CardFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center p-5 pt-0 md:p-6 md:pt-0", className)}>{children}</div>;
}