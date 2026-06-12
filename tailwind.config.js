/** @type {import('tailwindcss').Config} */

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    container: {
      center: true,
    },
    extend: {
      colors: {
        primary: {
          50: '#f0f5fa',
          100: '#d9e4ef',
          200: '#b3c9df',
          300: '#8aaecf',
          400: '#5c92bf',
          500: '#3a77b0',
          600: '#2a5d8a',
          700: '#1e4566',
          800: '#1e3a5f',
          900: '#152a42',
        }
      },
      animation: {
        'slide-in': 'slide-in 0.3s ease-out',
        'shake': 'shake 0.5s ease-in-out',
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
};
