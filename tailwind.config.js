/** Colours are CSS variables (RGB channels) so skins can recolour the whole
 * app by redefining them; see src/index.css and src/classic/skins.css. */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: token("ink-950"),
          900: token("ink-900"),
          800: token("ink-800"),
          700: token("ink-700"),
          600: token("ink-600"),
        },
        mist: {
          100: token("mist-100"),
          300: token("mist-300"),
          500: token("mist-500"),
        },
        ember: {
          DEFAULT: token("ember"),
          dim: token("ember-dim"),
          soft: token("ember-soft"),
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-sans)", "sans-serif"],
      },
    },
  },
  plugins: [],
};
