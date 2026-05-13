import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        lg: "2rem",
      },
      screens: {
        "2xl": "1280px",
      },
    },
    extend: {
      colors: {
        ink: {
          DEFAULT: "hsl(var(--ink) / <alpha-value>)",
          muted: "hsl(var(--ink-muted) / <alpha-value>)",
          subtle: "hsl(var(--ink-subtle) / <alpha-value>)",
        },
        navy: {
          DEFAULT: "hsl(var(--navy) / <alpha-value>)",
          deep: "hsl(var(--navy-deep) / <alpha-value>)",
          soft: "hsl(var(--navy-soft) / <alpha-value>)",
          tint: "hsl(var(--navy-tint) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "hsl(var(--surface) / <alpha-value>)",
          raised: "hsl(var(--surface-raised) / <alpha-value>)",
          sunken: "hsl(var(--surface-sunken) / <alpha-value>)",
          inverse: "hsl(var(--surface-inverse) / <alpha-value>)",
        },
        line: {
          DEFAULT: "hsl(var(--line) / <alpha-value>)",
          strong: "hsl(var(--line-strong) / <alpha-value>)",
          subtle: "hsl(var(--line-subtle) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          soft: "hsl(var(--accent-soft) / <alpha-value>)",
          deep: "hsl(var(--accent-deep) / <alpha-value>)",
        },
        seal: {
          DEFAULT: "hsl(var(--seal) / <alpha-value>)",
          soft: "hsl(var(--seal-soft) / <alpha-value>)",
        },
        signal: {
          success: "hsl(var(--signal-success) / <alpha-value>)",
          "success-soft": "hsl(var(--signal-success-soft) / <alpha-value>)",
          warning: "hsl(var(--signal-warning) / <alpha-value>)",
          "warning-soft": "hsl(var(--signal-warning-soft) / <alpha-value>)",
          error: "hsl(var(--signal-error) / <alpha-value>)",
          "error-soft": "hsl(var(--signal-error-soft) / <alpha-value>)",
          info: "hsl(var(--signal-info) / <alpha-value>)",
          "info-soft": "hsl(var(--signal-info-soft) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.04em" }],
        xs: ["0.75rem", { lineHeight: "1.125rem" }],
        sm: ["0.8125rem", { lineHeight: "1.25rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.0625rem", { lineHeight: "1.625rem" }],
        xl: ["1.1875rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.4375rem", { lineHeight: "1.875rem", letterSpacing: "-0.01em" }],
        "3xl": ["1.75rem", { lineHeight: "2.125rem", letterSpacing: "-0.015em" }],
        "4xl": ["2.125rem", { lineHeight: "2.5rem", letterSpacing: "-0.02em" }],
        "5xl": ["2.75rem", { lineHeight: "3.125rem", letterSpacing: "-0.025em" }],
      },
      letterSpacing: {
        widest: "0.16em",
      },
      borderRadius: {
        sm: "4px",
        md: "6px",
        lg: "10px",
        xl: "14px",
        "2xl": "18px",
      },
      boxShadow: {
        card: "0 1px 0 hsl(var(--line)), 0 1px 2px hsl(var(--shadow) / 0.04)",
        elevated:
          "0 1px 0 hsl(var(--line)), 0 8px 24px -12px hsl(var(--shadow) / 0.18), 0 2px 6px -2px hsl(var(--shadow) / 0.08)",
        focus: "0 0 0 4px hsl(var(--accent) / 0.16), 0 0 0 1px hsl(var(--accent))",
        "focus-inset": "inset 0 0 0 2px hsl(var(--accent))",
        seal: "0 0 0 1px hsl(var(--seal) / 0.32)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "scale(0.985)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 240ms ease-out",
        "fade-up": "fade-up 320ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        "scale-in": "scale-in 220ms cubic-bezier(0.22, 0.61, 0.36, 1)",
        shimmer: "shimmer 2s linear infinite",
        "soft-pulse": "soft-pulse 1.8s ease-in-out infinite",
      },
      backgroundImage: {
        "grid-lines":
          "linear-gradient(to right, hsl(var(--line) / 0.5) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--line) / 0.5) 1px, transparent 1px)",
        "fine-noise":
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.05  0 0 0 0 0.10  0 0 0 0 0.20  0 0 0 0.6 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/></svg>\")",
      },
    },
  },
  plugins: [],
};

export default config;
