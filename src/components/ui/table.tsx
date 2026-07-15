import type { ReactNode, TdHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn("w-full caption-bottom text-sm", className)}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <thead className={cn("[&_tr]:border-b", className)}>{children}</thead>;
}

export function TableBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)}>{children}</tbody>;
}

export function TableRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}>
      {children}
    </tr>
  );
}

export function TableHead({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0", className)}>
      {children}
    </th>
  );
}

export function TableCell({ children, className = "", ...props }: TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }) {
  return (
    <td className={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props}>
      {children}
    </td>
  );
}