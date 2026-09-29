/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#2f85fb',
          600: '#1b65f0',
          700: '#1550dc',
          800: '#1743b2',
          900: '#193d8c',
        },
      },
    },
  },
  plugins: [],
};
