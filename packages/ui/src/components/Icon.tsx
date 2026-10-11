import type { SVGProps } from "react";

/**
 * Small stroke icon set (16px grid, 1.5px stroke, currentColor).
 * Icons are decorative by default (aria-hidden). Pass `label` to make one meaningful.
 */
const paths = {
  check: <path d="M3 8.5l3 3 7-7" />,
  x: <path d="M4 4l8 8M12 4l-8 8" />,
  alert: (
    <>
      <path d="M8 2.5l6 11H2l6-11z" />
      <path d="M8 7v3M8 12v.01" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v4M8 5v.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  dot: <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />,
  ring: <circle cx="8" cy="8" r="3.5" />,
  play: <path d="M5 3.5l7 4.5-7 4.5z" />,
  stop: <rect x="4" y="4" width="8" height="8" rx="1" />,
  shield: (
    <>
      <path d="M8 2l5 2v4c0 3-2.2 5.2-5 6-2.8-.8-5-3-5-6V4l5-2z" />
      <path d="M5.8 8l1.6 1.6L10.5 6.5" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </>
  ),
  offline: (
    <>
      <path d="M2.5 6.2a8 8 0 0111 0M4.5 8.4a5 5 0 017 0M6.6 10.6a2 2 0 012.8 0" />
      <path d="M2.5 2.5l11 11" />
    </>
  ),
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.8 2 1.8 10 0 12M8 2c-1.8 2-1.8 10 0 12" />
    </>
  ),
  upload: <path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M3 13h10" />,
  download: <path d="M8 3v8M4.5 7.5L8 11l3.5-3.5M3 13h10" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5V3.5a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" />
    </>
  ),
  chevronRight: <path d="M6 3.5L10.5 8 6 12.5" />,
  chevronDown: <path d="M3.5 6L8 10.5 12.5 6" />,
  arrowLeft: <path d="M13 8H3M7 4L3 8l4 4" />,
  menu: <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />,
  refresh: (
    <>
      <path d="M13 8a5 5 0 11-1.5-3.5" />
      <path d="M13 2.5v3h-3" />
    </>
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <path d="M6.5 1.5v2.5M9.5 1.5v2.5M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5" />
    </>
  ),
  node: (
    <>
      <rect x="2" y="3" width="12" height="7" rx="1" />
      <path d="M5 13h6M8 10v3" />
    </>
  ),
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1" />
      <circle cx="5.5" cy="6.5" r="1" />
      <path d="M14 11l-3.5-3.5L4 13" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  list: <path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01" />,
  activity: <path d="M1.5 8h3l2-5 3 10 2-5h3" />,
  file: (
    <>
      <path d="M4 1.5h5.5L12.5 4.5v10h-8.5z" />
      <path d="M9.5 1.5v3h3" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M3 14c.6-2.6 2.6-4 5-4s4.4 1.4 5 4" />
    </>
  ),
  power: (
    <>
      <path d="M8 2v6" />
      <path d="M4.6 4.4a5 5 0 106.8 0" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Accessible label. Omit for decorative icons next to visible text. */
  label?: string;
}

export function Icon({ name, size = 16, label, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
