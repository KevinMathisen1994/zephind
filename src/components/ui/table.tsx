import type { ReactNode, TdHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative w-full overflow-auto rounded-xl border border-[var(--border-subtle)]">
      <table className={cn("w-full caption-bottom text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <thead className={cn("bg-[var(--bg-surface-hover)]", className)}>{children}</thead>;
}

export function TableBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tbody className={cn("divide-y divide-[var(--border-subtle)]", className)}>{children}</tbody>;
}

export function TableRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr
      className={cn(
        "transition-colors hover:bg-[var(--bg-surface-hover)]/70",
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
        "h-11 px-4 text-left align-middle text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]",
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