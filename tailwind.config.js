/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#F0F4FA', 100: '#D9E2F0', 200: '#B3C5E1', 500: '#1E3A5F', 600: '#183050', 700: '#122540', 800: '#0F172A', 900: '#0A1020' },
        gold: { 400: '#F5B731', 500: '#E5A520' },
        arimann: { blue: '#2563EB', lightblue: '#3B82F6' },
      },
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
