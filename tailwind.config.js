/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      keyframes: {
        progress: {
          '0%': { width: '0%' },
          '20%': { width: '40%' },
          '60%': { width: '70%' },
          '100%': { width: '90%' },
        }
      }
    },
  },
  plugins: [],
}
