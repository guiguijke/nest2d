import { translate, DEFAULT_LOCALE, LOCALES, formatNumber, formatPercent } from '~/utils/i18n'

/**
 * Locale state for the whole app.
 *
 * Strategy:
 *  1. If the user has a 'locale' cookie, use it (explicit choice wins).
 *  2. Otherwise, on first visit, the server route /api/locale maps the
 *     Cloudflare cf-ipcountry header to a locale ('FR' -> 'fr', else 'en').
 *     The result is stored in the cookie so it is stable across navigations.
 *  3. The switcher in MainHeader writes the cookie, which re-renders
 *     everything reactively.
 *
 * The locale is a module-level reactive singleton shared by every component
 * that calls useLocale() (same pattern as authStore / themeStore).
 */
const localeState = ref(DEFAULT_LOCALE)
let initialized = false

async function detectLocale() {
    // Cookie already set — explicit user choice, highest priority.
    const cookie = useCookie('locale', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    if (cookie.value && LOCALES.includes(cookie.value)) {
        return cookie.value
    }
    // No cookie — ask the server to detect from the visitor's country.
    try {
        const detected = await $fetch('/api/locale')
        if (detected?.locale && LOCALES.includes(detected.locale)) {
            cookie.value = detected.locale
            return detected.locale
        }
    } catch {
        // Server route unavailable — fall back to default.
    }
    return DEFAULT_LOCALE
}

export function useLocale() {
    const cookie = useCookie('locale', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

    // Detect once per client session (on first useLocale() call).
    if (import.meta.client && !initialized) {
        initialized = true
        detectLocale().then((loc) => {
            localeState.value = loc
        })
    }

    const locale = computed({
        get: () => localeState.value,
        set: (val) => {
            if (!LOCALES.includes(val)) return
            localeState.value = val
            cookie.value = val
        },
    })

    const setLocale = (val) => {
        locale.value = val
    }

    // Reactive translator bound to the current locale.
    const t = (key, params) => translate(key, localeState.value, params)

    // C20/C21 : formatage localisé des nombres affichés (%, aires).
    const fmtPercent = (v, digits = 1) => formatPercent(v, localeState.value, digits)
    const fmtNumber = (v, digits = 1) => formatNumber(v, localeState.value, digits)

    return { locale, setLocale, t, fmtPercent, fmtNumber }
}
