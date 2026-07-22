import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        paper: "#fbfaf7",
        rule: "#d9d3c7",
        sage: "#4d7c68",
        coral: "#c86446",
        gold: "#c69a35"
      }
    }
  },
  plugins: []
};

export default config;
