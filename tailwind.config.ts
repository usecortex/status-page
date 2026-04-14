import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "ui-1": "var(--ui-1)",
        "ui-2": "var(--ui-2)",
        text: "var(--text)",
        border: "var(--border)",
        "success-1": "var(--success-1)",
        "warning-1": "var(--warning-1)",
        "error-1": "var(--error-1)",
        blue: "var(--blue)",
      },
    },
  },
  plugins: [],
};

export default config;
