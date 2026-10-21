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
        "rounded-2xl border border-[var(--border-subtle)] bg-white text-[var(--text-primary)] shadow-xs hover:border-[var(--border-default)] hover:shadow-sm transition-all duration-200",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col space-y-1.5 p-5 md:p-6", className)}>{children}</div>;
}

export function CardTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={cn("text-lg md:text-xl font-extrabold tracking-tight text-[var(--text-primary)]", className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-xs md:text-sm text-[var(--text-muted)] font-medium leading-relaxed", className)}>{children}</p>;
}

export function CardContent({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-5 md:p-6", className)}>{children}</div>;
}

export function CardFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex items-center p-5 md:p-6 pt-0", className)}>{children}</div>;
}