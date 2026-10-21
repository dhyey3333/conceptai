"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-gradient-to-b from-accent-strong to-accent text-white shadow-[0_8px_24px_-8px_rgb(139_123_255/0.6)] hover:brightness-110 active:brightness-95",
  secondary: "bg-surface-3 text-fg border border-line-strong hover:bg-white/[0.08]",
  ghost: "text-muted hover:text-fg hover:bg-white/[0.06]",
  danger: "bg-danger/15 text-danger border border-danger/30 hover:bg-danger/25",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-xl",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-xl",
  icon: "h-9 w-9 rounded-lg",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }
>(function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-medium transition disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}
      {children}
    </button>
  );
});

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cn("animate-spin text-accent-strong", className)} />;
}

export function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] transition",
        active
          ? "border-accent/60 bg-accent/15 text-fg shadow-[inset_0_0_0_1px_rgb(139_123_255/0.25)]"
          : "border-line-strong text-muted hover:border-white/25 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; icon?: ReactNode; badge?: ReactNode }[];
}) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl bg-surface-2 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition",
            value === it.value ? "bg-surface-3 text-fg shadow" : "text-muted hover:text-fg",
          )}
        >
          {it.icon}
          {it.label}
          {it.badge}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2 text-[13px] text-muted">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 rounded-full transition", checked ? "bg-accent" : "bg-white/15")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong bg-surface-3 px-1.5 py-0.5 font-sans text-[11px] text-muted">{children}</kbd>;
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span
      className="relative grid place-items-center rounded-[10px] bg-gradient-to-br from-[#a597ff] via-[#7c6cff] to-[#2dd4bf] shadow-[0_6px_20px_-6px_rgb(124_108_255/0.7)]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M4 17c2.5-6 5.5-9 8-9s4 2 4 4-1.5 3.5-3.5 3.5S9 14 9 12" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="18.5" cy="6" r="1.8" fill="white" />
      </svg>
    </span>
  );
}
