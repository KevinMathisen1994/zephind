import type { ReactNode, TdHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative w-full overflow-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]">
      <table className={cn("w-full caption-bottom text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10 bg-[var(--bg-surface)] shadow-[inset_0_-1px_0_var(--border-default)]",
        className,
      )}
    >
      {children}
    </thead>
  );
}

export function TableBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tbody className={cn("divide-y divide-[var(--border-subtle)]", className)}>{children}</tbody>;
}

export function TableRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        "transition-colors duration-150 hover:bg-[var(--bg-surface-hover)]",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TableHead({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        "h-9 whitespace-nowrap px-4 text-left align-middle text-[9.5px] font-bold uppercase tracking-[0.14em] text-[var(--text-muted)]",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }) {
  return (
    <td className={cn("px-4 py-3 align-middle text-sm", className)} {...props}>
      {children}
    </td>
  );
}