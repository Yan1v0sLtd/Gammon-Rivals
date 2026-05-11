/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        board: {
          frame: '#c8a44a',
          felt: '#f3ead3',
          dark: '#1a1a1a',
          point: '#0e0e0e',
          accent: '#e7c66a',
        },
        chip: {
          gold: '#d6a83a',
          cream: '#f6efd6',
        },
      },
      fontFamily: {
        display: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['"Segoe UI"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
