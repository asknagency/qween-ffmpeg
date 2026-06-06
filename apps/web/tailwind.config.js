/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        sans: ['DM Sans', 'sans-serif'],
      },
      colors: {
        bg: '#0d0d0f',
        surface: '#141416',
        panel: '#1a1a1e',
        border: '#2a2a30',
        accent: '#7c6dfa',
        'accent-dim': '#4a3fa0',
        green: '#3ddc84',
        red: '#ff4f4f',
        muted: '#555566',
        sub: '#888899',
        text: '#e8e8f0',
      },
    },
  },
  plugins: [],
}
