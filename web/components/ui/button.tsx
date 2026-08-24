import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "pill";
export type ButtonSize = "sm" | "md";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-[30px] px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-surface hover:bg-ink/90 rounded-[9999px] font-medium",
  secondary:
    "bg-surface text-ink border border-line hover:bg-surface-raised rounded-[9999px] font-medium",
  ghost:
    "bg-transparent text-ink-muted hover:bg-surface-raised hover:text-ink rounded-[9999px] font-medium",
  pill:
    "bg-surface-raised text-ink hover:bg-line/60 rounded-[9999px] font-medium",
};

const BASE =
  "inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-soft focus-visible:ring-offset-0";

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: false;
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  asChild,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        BASE,
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}

export type LinkButtonProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  ...props
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      className={cn(
        BASE,
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
