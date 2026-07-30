/** @type {import('tailwindcss').Config} */
// NestorCut admin theme — dark, data-dense variant of the brand.
//
// Brand palette (from nestorcut-website/BRAND.md) mapped onto a dark admin
// surface for readability:
//   marine  #1A2340  -> primary surface (deepened to #141B33 for the app bg)
//   blue    #007BFF  -> accent (CTA, active states)
//   cyan    #00C2FF  -> gradient end + live highlights
//   mist    #F8FBFF  -> light section bg (unused here; dark variant instead)
//   line    #E1E8F0  -> borders (darkened to #2A3658)
//   muted   #55627D  -> secondary text (lightened for dark bg)
// Fonts: Poppins (headings) + Inter (body), per brand guidelines.
// Sharp corners: 4px radius everywhere (CNC-cut feel).
export default {
  content: ['./app/**/*.{vue,js,ts}', './app/app.vue'],
  theme: {
    extend: {
      colors: {
        // Marine surfaces (backgrounds)
        marine: {
          950: '#0f1428', // app background (deep)
          900: '#141b33', // primary dark surface
          850: '#1a2340', // brand marine — cards/headers
          800: '#212c4a', // raised surface
          700: '#2a3658', // borders (darkened brand line)
          600: '#3a4870', // hover border
          500: '#55627d', // brand muted
        },
        // Brand accent
        blue: {
          DEFAULT: '#007bff', // brand blue
          light: '#3395ff',
          dark: '#0062cc',
        },
        cyan: {
          DEFAULT: '#00c2ff', // gradient end
        },
        // Text on dark
        ink: {
          100: '#ffffff',
          200: '#c7d2e8', // brand dark-section text
          300: '#9fb0d0', // brand dark-section subtitle
          400: '#7384a8', // tertiary
        },
        ok: '#2fd07a',
        warn: '#f5b342',
        err: '#ff5470',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Poppins', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        // Sharp corners per brand (CNC feel). 4px everywhere.
        DEFAULT: '4px',
      },
    },
  },
  plugins: [],
}
