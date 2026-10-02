import type { SVGProps } from "react";

export type IconName =
  | "arrow"
  | "external"
  | "search"
  | "grid"
  | "list"
  | "chevron"
  | "close"
  | "menu"
  | "copy"
  | "check"
  | "code"
  | "sparkles"
  | "layers"
  | "globe"
  | "clock";
const paths: Record<IconName, React.ReactNode> = {
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  external: <path d="M7 17 17 7M7 7h10v10" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </>
  ),
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="3" />
      <path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  code: <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />,
  sparkles: (
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 2v4m-2-2h4" />
  ),
  layers: <path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
};
export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
export function BeaconMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="30"
      height="34"
      viewBox="0 0 30 34"
      fill="none"
      aria-hidden="true"
    >
      <path d="m15 2 4 10 9 5-9 5-4 10-4-10-9-5 9-5 4-10Z" fill="currentColor" />
      <path d="M15 11v12M10 17h10" stroke="white" strokeWidth="1.5" />
    </svg>
  );
}
export function EthereumMark() {
  return (
    <svg width="13" height="20" viewBox="0 0 13 21" aria-hidden="true">
      <path d="m6.5 0 6.5 10.7-6.5 3.8L0 10.7 6.5 0Z" fill="currentColor" opacity=".65" />
      <path d="m6.5 0 6.5 10.7-6.5-3V0Z" fill="currentColor" />
      <path d="m0 12 6.5 9L13 12l-6.5 3.8L0 12Z" fill="currentColor" />
    </svg>
  );
}
