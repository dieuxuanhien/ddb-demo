/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        discord: {
          bg: "#1e1f22",
          sidebar: "#2b2d31",
          card: "#313338",
          input: "#383a40",
          accent: "#5865f2",
          green: "#23a55a",
          muted: "#949ba4",
          heading: "#f2f3f5",
        },
      },
      keyframes: {
        pulse_slow: {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.4 },
        },
        fadeIn: {
          from: { opacity: 0, transform: "translateY(8px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        nodeFlash: {
          "0%": { boxShadow: "0 0 0 0 rgba(88,101,242,0.8)" },
          "70%": { boxShadow: "0 0 0 18px rgba(88,101,242,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(88,101,242,0)" },
        },
        nodeFlashGreen: {
          "0%": { boxShadow: "0 0 0 0 rgba(35,165,90,0.9)" },
          "70%": { boxShadow: "0 0 0 22px rgba(35,165,90,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(35,165,90,0)" },
        },
        evaluating: {
          "0%, 100%": { borderColor: "#5865f2" },
          "50%": { borderColor: "#faa61a" },
        },
      },
      animation: {
        pulse_slow: "pulse_slow 2s ease-in-out infinite",
        fadeIn: "fadeIn 0.3s ease-out",
        nodeFlash: "nodeFlash 0.8s ease-out forwards",
        nodeFlashGreen: "nodeFlashGreen 1s ease-out forwards",
        evaluating: "evaluating 0.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
