/** @type {import('tailwindcss').Config} */
// Dark back-office theme tuned to the APlasma brand palette
// (anthracite background, rust accent) so the admin feels related to the
// product without reusing its SCSS.
export default {
  content: [
    './app/**/*.{vue,js,ts}',
    './app/app.vue',
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces
        ink: {
          950: '#171c1f',
          900: '#1c2226',
          850: '#21282c',
          800: '#273034',
          700: '#323c41',
          600: '#46535a',
          400: '#7d8a91',
          300: '#9aa6ac',
          200: '#c2cbcf',
          100: '#e3e8ea',
        },
        // APlasma rust accent
        rust: {
          DEFAULT: '#c87a1c',
          light: '#e0902a',
          dark: '#8c5410',
        },
        ok: '#3f9d5a',
        warn: '#d8a02b',
        err: '#de0036',
      },
      fontFamily: {
        sans: ['Montserrat', 'system-ui', 'sans-serif'],
        mono: ['SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
