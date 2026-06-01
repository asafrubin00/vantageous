/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        dark: '#1a1a1a',
        'dark-card': '#242424',
        'dark-border': '#333333',
        salmon: '#FCD299',
        'salmon-dim': '#d4a96e',
      },
      fontFamily: {
        headline: ['Georgia', '"Times New Roman"', 'serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
