import type { Config } from "tailwindcss";

/**
 * FYIP TERMINAL design tokens — institutional workstation palette.
 * Near-black / graphite backgrounds, restrained amber accents, thin separators,
 * dense tabular typography. Values are mirrored as CSS custom properties in
 * app/globals.css so charts and canvas code can read the same palette.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: "#07080A",
        panel: "#0C0E12",
        "panel-2": "#111419",
        "panel-3": "#161A21",
        line: "#1E232C",
        "line-2": "#2A313C",
        ink: "#E7EAEE",
        "ink-dim": "#9AA3AF",
        "ink-faint": "#5F6875",
        amber: "#E0A63C",
        "amber-dim": "#8A6524",
        up: "#22A06B",
        down: "#E5484D",
        info: "#3E8FB0",
        warn: "#D9A441",
        stale: "#7A6A3A",
        violet: "#7C6CF0",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.02em" }],
        "3xs": ["0.625rem", { lineHeight: "0.875rem", letterSpacing: "0.04em" }],
      },
      spacing: {
        row: "1.375rem",
      },
      keyframes: {
        flash: {
          "0%": { backgroundColor: "rgba(224,166,60,0.18)" },
          "100%": { backgroundColor: "transparent" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
        ticker: {
          from: { transform: "translate3d(0,0,0)" },
          to: { transform: "translate3d(-50%,0,0)" },
        },
      },
      animation: {
        flash: "flash 0.6s ease-out",
        blink: "blink 1.4s ease-in-out infinite",
        ticker: "ticker 40s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;