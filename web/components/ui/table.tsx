import Link from "next/link";
import type {
  CSSProperties,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

export type TableDensity = "default" | "compact";

const ROW_HEIGHT: Record<TableDensity, string> = {
  default: "44px",
  compact: "36px",
};

function cn(...parts: Array<string | undefined | false>) {
  return parts.filter(Boolean).join(" ");
}

export function Table({
  density = "default",
  className,
  children,
}: {
  density?: TableDensity;
  className?: string;
  children: ReactNode;
}) {
  const style = { "--row-h": ROW_HEIGHT[density] } as CSSProperties;
  return (
    <table
      style={style}
      className={cn("w-full border-collapse text-sm", className)}
    >
      {children}
    </table>
  );
}

export function THead({
  rowLinks,
  bg = "canvas",
  children,
}: {
  rowLinks?: boolean;
  bg?: "canvas" | "surface";
  children: ReactNode;
}) {
  return (
    <thead
      className={cn(
        "sticky top-0 z-10",
        bg === "surface" ? "bg-surface" : "bg-canvas",
      )}
    >
      <tr>
        {rowLinks ? (
          <th className="w-0 border-0 p-0" aria-hidden="true" />
        ) : null}
        {children}
      </tr>
    </thead>
  );
}

export function TH({
  align,
  className,
  children,
  ...props
}: { align?: "left" | "right" | "center" } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "h-9 border-b border-line px-4 text-[13px] font-medium text-ink-muted",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  href,
  className,
  children,
}: {
  href?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <tr
      className={cn(
        "relative h-[var(--row-h,44px)] border-b border-line",
        href && "hover:bg-surface-raised",
        className,
      )}
    >
      {href ? (
        <td className="relative w-0 border-0 p-0">
          <Link
            href={href}
            className="absolute inset-y-0 left-0 z-[1] w-[100vw]"
            aria-label="Ver detalhes"
            tabIndex={-1}
          />
        </td>
      ) : null}
      {children}
    </tr>
  );
}

export function TD({
  align,
  numeric,
  className,
  children,
  ...props
}: {
  align?: "left" | "right" | "center";
  numeric?: boolean;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        "px-4 text-ink",
        numeric && "tabular-nums",
        align === "right"
          ? "text-right"
          : align === "center"
            ? "text-center"
            : "text-left",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}
