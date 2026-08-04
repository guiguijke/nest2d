import {
    DEFAULT_UNIT,
    isValidUnit,
    unitLabel,
    fmtLength,
    fmtLengthValue,
    fmtArea,
    mmToDisplay,
    displayToMm,
    convertInputValue,
} from '~/utils/units'

/**
 * Preferred measurement unit for the whole app ('mm' | 'inch').
 *
 * Strategy (same pattern as useLocale):
 *  1. A 'unit' cookie gives the explicit choice instantly (SSR-safe).
 *  2. Once the session user is loaded, the DB value (users.preferredUnit)
 *     wins over the cookie — the account preference follows the user
 *     across devices.
 *  3. Switching writes the cookie AND PATCHes /api/user/preferences.
 *
 * The master switch is the NUXT_PUBLIC_UNIT_SWITCH_ENABLED env flag: when
 * off, the unit is forced to 'mm' and the switcher is hidden — the feature
 * ships dark.
 *
 * Everything internal stays mm — this composable only drives display and
 * input conversion at the UI boundary.
 */
const unitState = ref(DEFAULT_UNIT)
let enabledState = false
let initialized = false

/**
 * Non-composable accessor for module-level stores (files.js / strip.js)
 * whose computed request bodies run outside component setup. Honors the
 * master switch: 'mm' whenever the feature is disabled.
 */
export function getUnitState() {
    return enabledState ? unitState.value : DEFAULT_UNIT
}

export function useUnit() {
    const config = useRuntimeConfig()
    // Env overrides arrive as strings ('true'), not booleans.
    const flagOn =
        config.public.unitSwitchEnabled === true || config.public.unitSwitchEnabled === 'true'
    const enabled = computed(() => flagOn)
    enabledState = flagOn
    const cookie = useCookie('unit', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
    // Shared hydrated user cache — the SAME source the DB watcher below
    // uses (trap #30). Also drives the persistence gate in the setter:
    // authStore.userIsSet lags behind on a fresh SSR page load (the store
    // is only populated once the client middleware re-runs setUser), so a
    // quick unit switch would silently skip the PATCH — and the watcher
    // would flip the unit back to the stale DB value seconds later.
    const { data: userData } = useNuxtData('user')

    if (import.meta.client && !initialized) {
        initialized = true
        if (enabled.value && isValidUnit(cookie.value)) {
            unitState.value = cookie.value
        }
        // DB wins over the cookie once the user is known. Watch the SHARED
        // asyncData cache (hydrated from the SSR payload, refreshed by
        // setUser on every navigation) with the auth store as fallback —
        // watching authStore alone misses updates tied to the cached
        // payload (SPA login never re-calls setUser on the same page).
        watch(
            () => userData.value?.preferredUnit ?? authStore.getters.user.value?.preferredUnit,
            (preferred) => {
                if (!enabled.value) return
                if (isValidUnit(preferred)) {
                    unitState.value = preferred
                    cookie.value = preferred
                }
            },
            { immediate: true }
        )
    }

    const unit = computed({
        get: () => (enabled.value ? unitState.value : DEFAULT_UNIT),
        set: (val) => {
            if (!isValidUnit(val) || !enabled.value) return
            unitState.value = val
            cookie.value = val
            // Persist per-user (fire and forget — the cookie already gives
            // instant UX, the DB syncs other devices). Gate on the shared
            // user cache, NOT authStore.userIsSet (see above).
            if (userData.value?.id) {
                $fetch('/api/user/preferences', {
                    method: 'PATCH',
                    body: { preferredUnit: val },
                }).catch((e) => console.warn('preferredUnit persist failed', e))
            }
        },
    })

    const setUnit = (val) => {
        unit.value = val
    }

    // Bound helpers — components just call fmtLength(mmValue).
    return {
        unit,
        setUnit,
        enabled,
        unitLabel: computed(() => unitLabel(unit.value)),
        fmtLength: (mm) => fmtLength(mm, unit.value),
        fmtLengthValue: (mm, decimals) => fmtLengthValue(mm, unit.value, decimals),
        fmtArea: (mm2) => fmtArea(mm2, unit.value),
        mmToDisplay: (mm) => mmToDisplay(mm, unit.value),
        displayToMm: (v) => displayToMm(v, unit.value),
        convertInputValue: (str, from, to) => convertInputValue(str, from, to),
    }
}
