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
        "flex h-10 w-full items-center justify-between border border-border bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 appearance-none cursor-pointer",
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