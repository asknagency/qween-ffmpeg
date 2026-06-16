/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:     '#0d0d0f',
        panel:  '#111116',
        border: '#1e1e28',
        text:   '#e8e8f0',
        sub:    '#8888aa',
        muted:  '#55556a',
        accent: '#7c6dfa',
        green:  '#4ade80',
        red:    '#f87171',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
