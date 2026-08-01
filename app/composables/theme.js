import { computed, reactive, readonly } from "vue";
import { defaultThemeType, themeType } from "~~/constants/theme.constants";

// useCookie requires a Nuxt instance — resolved lazily so this module can be
// evaluated outside a setup/plugin context (SSR module graph, workers, tests).
let themeCookie = null;
function getThemeCookie() {
    if (!themeCookie) {
        themeCookie = useCookie('theme');
    }
    return themeCookie;
}

const state = reactive({
    theme: defaultThemeType,
})

function updateTheme() {
    // Sync from the cookie first — the module state alone can't know the
    // persisted preference.
    state.theme = getThemeCookie().value || state.theme;

    if (state.theme === themeType.primary) {
        state.theme = defaultThemeType
    } else if (state.theme === defaultThemeType) {
        state.theme = themeType.primary
    }
    getThemeCookie().value = state.theme;
    document.documentElement.setAttribute('data-theme', state.theme);
}

export const themeStore = readonly({
    getters: {
        theme: computed(() => state.theme),
    },
    actions: {
        updateTheme
    }
});
