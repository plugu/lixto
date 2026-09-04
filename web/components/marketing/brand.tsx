import Link from "next/link";
import type { ReactNode } from "react";
import { editorial } from "./fonts";

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="28" height="28" rx="8.5" fill="#0f766e" />
      <path
        d="M9.2 7.6v11.2h6.1"
        fill="none"
        stroke="#5eead4"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19.3 8.2v5.4M16.6 10.9h5.4"
        fill="none"
        stroke="#5eead4"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  // editorial.variable is applied here (not only on the landing wrapper) so the
  // wordmark keeps its Fraunces face when the logo renders inside app chrome.
  return (
    <span
      className={`inline-flex items-center ${editorial.variable} ${
        compact ? "gap-2" : "gap-2.5"
      } ${className}`}
    >
      <LogoMark className={compact ? "h-6 w-6" : "h-7 w-7"} />
      <span
        className={`font-editorial leading-none font-semibold tracking-[-0.01em] ${
          compact ? "text-[17px]" : "text-[19px]"
        }`}
      >
        Lixto
      </span>
    </span>
  );
}

/** Section eyebrow: small caps label with a leading rule. */
export function Eyebrow({
  children,
  tone = "dark",
}: {
  children: ReactNode;
  tone?: "dark" | "light";
}) {
  return (
    <p
      className={`flex items-center gap-3 text-[11px] font-semibold tracking-[0.18em] uppercase ${
        tone === "dark" ? "text-mint/80" : "text-accent"
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-px w-8 ${tone === "dark" ? "bg-mint/40" : "bg-accent/40"}`}
      />
      {children}
    </p>
  );
}

const CTA_BASE =
  "inline-flex items-center justify-center gap-2 rounded-full px-6 text-[15px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mint focus-visible:ring-offset-2";

export function CtaPrimary({
  children,
  href = "/signup",
  onDark = false,
}: {
  children: ReactNode;
  href?: string;
  onDark?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${CTA_BASE} h-12 ${
        onDark
          ? "bg-mint text-night hover:bg-mint/85 focus-visible:ring-offset-night"
          : "bg-accent text-white hover:bg-accent/90 focus-visible:ring-accent focus-visible:ring-offset-canvas"
      }`}
    >
      {children}
      <svg
        viewBox="0 0 16 16"
        aria-hidden="true"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
      </svg>
    </Link>
  );
}

export function CtaSecondary({
  children,
  href,
  onDark = false,
}: {
  children: ReactNode;
  href: string;
  onDark?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`${CTA_BASE} h-12 border ${
        onDark
          ? "border-night-line text-canvas hover:border-mint/50 hover:text-mint focus-visible:ring-offset-night"
          : "border-line text-ink hover:border-accent/50 hover:text-accent focus-visible:ring-accent focus-visible:ring-offset-canvas"
      }`}
    >
      {children}
    </Link>
  );
}
