import {
    DEFAULT_UNIT,
    isValidUnit,
    unitLabel,
    fmtLength,
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
let initialized = false

export function useUnit() {
    const config = useRuntimeConfig()
    const enabled = computed(() => config.public.unitsEnabled === true)
    const cookie = useCookie('unit', { maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })

    if (import.meta.client && !initialized) {
        initialized = true
        if (enabled.value && isValidUnit(cookie.value)) {
            unitState.value = cookie.value
        }
        // DB wins over the cookie once the user is known; reset the watch
        // source on logout (user becomes {}).
        watch(
            () => authStore.getters.user.value?.preferredUnit,
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
            // instant UX, the DB syncs other devices).
            if (authStore.getters.userIsSet.value) {
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
        fmtArea: (mm2) => fmtArea(mm2, unit.value),
        mmToDisplay: (mm) => mmToDisplay(mm, unit.value),
        displayToMm: (v) => displayToMm(v, unit.value),
        convertInputValue: (str, from, to) => convertInputValue(str, from, to),
    }
}
