/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        panel: "#1e1f26",
        panelAlt: "#262833",
        edge: "#34374a",
        accent: "#c9a227",
      },
    },
  },
  plugins: [],
};
