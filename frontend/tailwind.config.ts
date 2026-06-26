import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        line: "var(--line)",
        "line-strong": "var(--line-strong)",
        surface: "var(--surface)",
        "surface-elevated": "var(--surface-elevated)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        amber: "var(--amber)",
        emerald: "var(--emerald)",
        rose: "var(--rose)",
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        body: ["var(--font-body)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      backgroundImage: {
        "dot-grid": "radial-gradient(circle, var(--line-strong) 1px, transparent 1px)",
      },
      backgroundSize: {
        "dot-grid": "22px 22px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        lg: "var(--radius-lg)",
      },
    },
  },
  plugins: [],
};
export default config;
