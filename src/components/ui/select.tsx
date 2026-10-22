import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
}

interface SelectTriggerProps {
  children: ReactNode;
  className?: string;
}

interface SelectContentProps {
  children: ReactNode;
  className?: string;
}

interface SelectItemProps {
  children: ReactNode;
  value: string;
  className?: string;
}

interface SelectValueProps {
  placeholder?: string;
}

export function Select({ children, className = "", value, onValueChange, ...props }: SelectProps) {
  return (
    <select
      className={cn(
        "flex h-10 w-full cursor-pointer appearance-none items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2214%22 height=%2214%22 fill=%22none%22 stroke=%22%23857e74%22 stroke-width=%221.6%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22m3 5.5 4 4 4-4%22/%3E%3C/svg%3E')] bg-[length:14px_14px] bg-[position:right_12px_center] bg-no-repeat px-3.5 pr-9 text-sm font-medium text-[var(--text-primary)] transition-[border-color,box-shadow] duration-150 focus:border-[var(--text-primary)] focus:shadow-[0_0_0_3px_rgba(26,113,0,0.14)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
      {...props}
    >
      {children}
    </select>
  );
}

export function SelectTrigger({ children, className }: SelectTriggerProps) {
  return (
    <div className={cn("flex h-10 w-full items-center justify-between border border-border bg-transparent px-3 py-2 text-sm", className)}>
      {children}
    </div>
  );
}

export function SelectContent({ children }: SelectContentProps) {
  return <>{children}</>;
}

export function SelectItem({ children, value, className }: SelectItemProps) {
  return (
    <option value={value} className={className}>
      {children}
    </option>
  );
}

export function SelectValue({ placeholder }: SelectValueProps) {
  return <option value="" disabled>{placeholder}</option>;
}