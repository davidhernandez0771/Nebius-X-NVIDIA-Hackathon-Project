// The setup page's icons: one drawn set, 1.5 px strokes on a 16 px grid, coloured by currentColor.
import type { SVGProps } from "react";

const base = (p: SVGProps<SVGSVGElement>) => ({
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...p,
});

/** A revolute joint: a turn about an axis. */
export const RevoluteIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M12.5 8a4.5 4.5 0 1 1-1.6-3.4" />
    <path d="M11.2 2.2v2.6H8.6" />
    <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** A prismatic joint: a slide along an axis. */
export const PrismaticIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 8h11" />
    <path d="M5 5.5 2.5 8 5 10.5" />
    <path d="M11 5.5 13.5 8 11 10.5" />
  </svg>
);

/** A fixed joint: two parts welded. */
export const FixedIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M3 8h10" />
    <path d="M6 5.5v5M10 5.5v5" />
  </svg>
);

export const UploadIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base({ width: 20, height: 20, ...p })}>
    <path d="M8 10.5V2.5" />
    <path d="M5 5.5 8 2.5l3 3" />
    <path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
  </svg>
);

export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m4.5 4.5 7 7M11.5 4.5l-7 7" />
  </svg>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

export const WarnIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M8 2.5 14 13H2z" />
    <path d="M8 6.5v3" />
    <circle cx="8" cy="11.25" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const SlidersIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);

export function JointIcon({ type, ...p }: { type: string } & SVGProps<SVGSVGElement>) {
  if (type === "prismatic") return <PrismaticIcon {...p} />;
  if (type === "fixed") return <FixedIcon {...p} />;
  return <RevoluteIcon {...p} />;
}
