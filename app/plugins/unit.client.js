/**
 * Initializes the unit preference singleton at app start, in the plugin's
 * app-lifetime effect scope. Without this, useUnit's internal watch is
 * registered by whichever component calls it first — and dies when that
 * component unmounts (layout change on navigation), silently disabling the
 * DB preference sync for the rest of the session.
 */
export default defineNuxtPlugin(() => {
    useUnit()
})
