// ===========================================================================
// AXOM brand primitives. The official angular mark remains a tintable SVG so
// it stays crisp in compact navigation, high-density displays, and print.
// Geometry is traced from the AXOM ident film: an apex whose arms hook inward
// toward a centre diamond, over two flaring legs.
// ===========================================================================
import { useId } from "react";

export type AxomWordmarkSize = "sm" | "md" | "lg" | "hero";
export type AxomMarkSize = "xs" | "sm" | "md" | "lg" | "hero";

const MARK_SIZE: Record<AxomMarkSize, number> = {
  xs: 18,
  sm: 28,
  md: 36,
  lg: 52,
  hero: 88,
};

export interface AxomWordmarkProps {
  size?: AxomWordmarkSize;
  muted?: boolean;
  compact?: boolean;
  className?: string;
}

export interface AxomMarkProps {
  /** Numeric values remain supported for existing compact placements. */
  size?: AxomMarkSize | number;
  framed?: boolean;
  /** "metal": the brushed ivory of the brand film (graphite on light surfaces). */
  finish?: "flat" | "metal";
  className?: string;
  /** Provide when the mark appears without the visible AXOM wordmark. */
  ariaLabel?: string;
}

export interface AxomBrandLockupProps {
  layout?: "horizontal" | "vertical";
  size?: AxomWordmarkSize;
  showWordmark?: boolean;
  showMark?: boolean;
  subtitle?: string;
  className?: string;
  markFramed?: boolean;
  markFinish?: AxomMarkProps["finish"];
}

export function AxomWordmark({
  size = "md",
  muted = false,
  compact = false,
  className = "",
}: AxomWordmarkProps) {
  return (
    <span
      className={[
        "brand-wordmark",
        "axom-wordmark",
        `axom-wordmark--${size}`,
        muted ? "is-muted" : "",
        compact ? "is-compact" : "",
        className,
      ].filter(Boolean).join(" ")}
    >
      <svg
        viewBox="0 0 410 92"
        role="img"
        aria-label="AXOM"
        focusable="false"
      >
        <path
          className="axom-wordmark__lettering"
          d="M22 82 52 20 82 82 M122 20l56 62 M178 20l-56 62 M332 82V20l25 39 25-39v62"
        />
        <circle
          className="axom-wordmark__lettering"
          cx="251"
          cy="51"
          r="31"
        />
      </svg>
    </span>
  );
}

export function AxomMark({
  size = "md",
  framed = false,
  finish = "flat",
  className = "",
  ariaLabel,
}: AxomMarkProps) {
  const pixels = typeof size === "number" ? size : MARK_SIZE[size];
  const gradientId = `axom-metal-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span
      className={[
        "axom-mark",
        framed ? "axom-mark--framed" : "",
        typeof size === "string" ? `axom-mark--${size}` : "",
        className,
      ].filter(Boolean).join(" ")}
      style={{ width: pixels, height: pixels }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="currentColor"
        role={ariaLabel ? "img" : undefined}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
        focusable="false"
      >
        {finish === "metal" && (
          <defs>
            <linearGradient id={gradientId} x1="0.15" y1="0" x2="0.85" y2="1">
              <stop offset="0" style={{ stopColor: "var(--axom-mark-hi)" }} />
              <stop offset="0.55" style={{ stopColor: "var(--axom-mark-mid)" }} />
              <stop offset="1" style={{ stopColor: "var(--axom-mark-lo)" }} />
            </linearGradient>
          </defs>
        )}
        <g fill={finish === "metal" ? `url(#${gradientId})` : undefined}>
          {/* apex whose arms hook inward to fine points */}
          <polygon points="50,6 72.4,45.5 58.1,58.1 65.3,44 50,21.3 34.7,44 41.9,58.1 27.6,45.5" />
          {/* centre diamond */}
          <polygon points="50,56.4 57.2,63.3 50,70.2 42.8,63.3" />
          {/* flaring legs */}
          <polygon points="22.88,54.34 28.97,56.55 6.83,94 0,93.1" />
          <polygon points="77.12,54.34 71.03,56.55 93.17,94 100,93.1" />
        </g>
      </svg>
    </span>
  );
}

export function AxomBrandLockup({
  layout = "horizontal",
  size = "md",
  showWordmark = true,
  showMark = true,
  subtitle,
  className = "",
  markFramed = false,
  markFinish = "flat",
}: AxomBrandLockupProps) {
  if (!showMark && !showWordmark) return null;

  const markSize: AxomMarkSize = size === "hero" ? "hero" : size === "lg" ? "lg" : size === "md" ? "md" : "sm";
  return (
    <span className={`axom-brand-lockup axom-brand-lockup--${layout} axom-brand-lockup--${size} ${className}`.trim()}>
      {showMark && (
        <AxomMark
          size={markSize}
          framed={markFramed}
          finish={markFinish}
          ariaLabel={showWordmark ? undefined : "AXOM"}
        />
      )}
      {(showWordmark || subtitle) && (
        <span className="axom-brand-lockup__copy">
          {showWordmark && <AxomWordmark size={size} compact={size === "sm"} />}
          {subtitle && <span className="axom-brand-lockup__subtitle">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}
