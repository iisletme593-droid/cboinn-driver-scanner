/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0e1a',
        panel: '#0f1626',
        panel2: '#141d30',
        edge: 'rgba(255,255,255,0.10)',
        brand: '#3b82f6',
        brand2: '#22d3ee',
      },
    },
  },
  plugins: [],
};
