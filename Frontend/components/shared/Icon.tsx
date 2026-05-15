import * as React from "react";

/**
 * A tiny SVG icon set. Stroke-based, 1.5px, 24x24. Keeps the visual language consistent.
 */

type IconProps = React.SVGAttributes<SVGSVGElement> & { size?: number };

function Base({
  size = 16,
  className,
  children,
  ...rest
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icon = {
  Shield: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-3z" />
    </Base>
  ),
  Lock: (p: IconProps) => (
    <Base {...p}>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Base>
  ),
  Mail: (p: IconProps) => (
    <Base {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </Base>
  ),
  Phone: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92Z" />
    </Base>
  ),
  ChevronRight: (p: IconProps) => (
    <Base {...p}>
      <path d="m9 6 6 6-6 6" />
    </Base>
  ),
  ChevronLeft: (p: IconProps) => (
    <Base {...p}>
      <path d="m15 6-6 6 6 6" />
    </Base>
  ),
  ArrowRight: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </Base>
  ),
  Check: (p: IconProps) => (
    <Base {...p}>
      <path d="M5 12l5 5L20 7" />
    </Base>
  ),
  Plus: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 5v14M5 12h14" />
    </Base>
  ),
  X: (p: IconProps) => (
    <Base {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Base>
  ),
  Edit: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 20h4l10.5-10.5a2.121 2.121 0 0 0-3-3L5 17v3Z" />
      <path d="m13.5 6.5 3 3" />
    </Base>
  ),
  Eye: (p: IconProps) => (
    <Base {...p}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  ),
  EyeOff: (p: IconProps) => (
    <Base {...p}>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.7 18.7 0 0 1 4.06-4.94" />
      <path d="M9.9 4.24A10.74 10.74 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <path d="M2 2l20 20" />
    </Base>
  ),
  User: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Base>
  ),
  Users: (p: IconProps) => (
    <Base {...p}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20c1-3.5 3.4-5.25 6-5.25s5 1.75 6 5.25" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 14.5c1.4 0 4.6 0 6 5" />
    </Base>
  ),
  Building: (p: IconProps) => (
    <Base {...p}>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
      <path d="M15 9h4a1 1 0 0 1 1 1v11" />
      <path d="M7 8h1M7 12h1M7 16h1M11 8h1M11 12h1M11 16h1M17 13h1M17 17h1" />
    </Base>
  ),
  Doc: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6" />
    </Base>
  ),
  Clock: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Base>
  ),
  Bell: (p: IconProps) => (
    <Base {...p}>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9Z" />
      <path d="M10 21a2 2 0 0 0 4 0" />
    </Base>
  ),
  Settings: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.31.36.5.81.5 1.32V11h.09a2 2 0 0 1 0 4H20Z" />
    </Base>
  ),
  Logout: (p: IconProps) => (
    <Base {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Base>
  ),
  Link: (p: IconProps) => (
    <Base {...p}>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1 1" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1-1" />
    </Base>
  ),
  Refresh: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
    </Base>
  ),
  Info: (p: IconProps) => (
    <Base {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-5M12 8h.01" />
    </Base>
  ),
  Star: (p: IconProps) => (
    <Base {...p}>
      <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6L12 16.9 6.6 19.7l1-6L3.2 9.4l6.1-.9L12 3Z" />
    </Base>
  ),
  Sparkle: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6 7.7 7.7M16.3 16.3l2.1 2.1M5.6 18.4 7.7 16.3M16.3 7.7l2.1-2.1" />
    </Base>
  ),
  Filing: (p: IconProps) => (
    <Base {...p}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h5" />
    </Base>
  ),
  Chat: (p: IconProps) => (
    <Base {...p}>
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 21l1.9-5.4A8 8 0 1 1 21 12Z" />
    </Base>
  ),
  Send: (p: IconProps) => (
    <Base {...p}>
      <path d="M22 2 11 13" />
      <path d="m22 2-7 20-4-9-9-4 20-7Z" />
    </Base>
  ),
  Paperclip: (p: IconProps) => (
    <Base {...p}>
      <path d="m21 12-8.5 8.5a5 5 0 1 1-7-7L14 5a3.5 3.5 0 1 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 8" />
    </Base>
  ),
  Heart: (p: IconProps) => (
    <Base {...p}>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.6Z" />
    </Base>
  ),
  ThumbsUp: (p: IconProps) => (
    <Base {...p}>
      <path d="M7 22V11" />
      <path d="M3 11h4v11H3z" />
      <path d="M7 11h9.3a2.7 2.7 0 0 1 2.7 3.2l-1.2 6.2a2 2 0 0 1-2 1.6H7" />
      <path d="M11 11V6a3 3 0 0 1 3-3l1 4-4 4" />
    </Base>
  ),
  Download: (p: IconProps) => (
    <Base {...p}>
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </Base>
  ),
};
