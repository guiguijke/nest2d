<template>
    <div class="locale" ref="root">
        <button
            class="locale__trigger"
            @click="toggle"
            :aria-label="t('nav.toggleTheme') && 'Language'"
            :aria-expanded="isOpen"
        >
            <span class="locale__flag" v-html="current.flag" />
            <span class="locale__code">{{ current.code.toUpperCase() }}</span>
            <svg class="locale__chevron" :class="{ 'locale__chevron--open': isOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </button>
        <transition name="locale-fade">
            <ul v-if="isOpen" class="locale__menu" role="listbox">
                <li
                    v-for="loc in locales"
                    :key="loc.code"
                    :class="['locale__item', { 'locale__item--active': loc.code === locale }]"
                    @click="choose(loc.code)"
                    role="option"
                    :aria-selected="loc.code === locale"
                >
                    <span class="locale__flag" v-html="loc.flag" />
                    <span class="locale__name">{{ loc.name }}</span>
                    <svg v-if="loc.code === locale" class="locale__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                </li>
            </ul>
        </transition>
    </div>
</template>

<script setup>
import { LOCALES, translate } from '~/utils/i18n'

const { locale, setLocale } = useLocale()

// Inline SVG flags (emoji flags don't render on Windows, so use real SVG
// for reliability). Kept compact — just the colored regions.
const FLAGS = {
    en: `<svg viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="18" fill="#012169"/><path d="M0 0l24 18M24 0L0 18" stroke="#fff" stroke-width="3.6"/><path d="M0 0l24 18M24 0L0 18" stroke="#C8102E" stroke-width="1.2"/><path d="M12 0v18M0 9h24" stroke="#fff" stroke-width="2"/><path d="M12 0v18M0 9h24" stroke="#C8102E" stroke-width="1.2"/></svg>`,
    fr: `<svg viewBox="0 0 24 18" xmlns="http://www.w3.org/2000/svg"><rect width="8" height="18" fill="#0055A4"/><rect x="8" width="8" height="18" fill="#fff"/><rect x="16" width="8" height="18" fill="#EF4135"/></svg>`,
}

const META = {
    en: { name: 'English' },
    fr: { name: 'Français' },
}

const locales = LOCALES.map((code) => ({
    code,
    flag: FLAGS[code],
    name: META[code]?.name || code,
}))

const current = computed(() => locales.find((l) => l.code === locale.value) || locales[0])

// Generic translator alias (kept so the trigger aria-label can be localized
// later without re-wiring). For now the trigger uses a stable "Language".
const t = (key) => translate(key, locale.value)

const isOpen = ref(false)
const root = ref(null)

function toggle() {
    isOpen.value = !isOpen.value
}

function choose(code) {
    setLocale(code)
    isOpen.value = false
}

// Close on outside click / Escape.
function onClickOutside(e) {
    if (root.value && !root.value.contains(e.target)) {
        isOpen.value = false
    }
}
function onKey(e) {
    if (e.key === 'Escape') isOpen.value = false
}
onMounted(() => {
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
    document.removeEventListener('click', onClickOutside)
    document.removeEventListener('keydown', onKey)
})
</script>

<style lang="scss" scoped>
.locale {
    position: relative;
    display: inline-flex;
    margin-left: 8px;

    &__trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--separator-primary);
        background-color: var(--background-primary);
        cursor: pointer;
        font-size: 13px;
        font-weight: 700;
        color: var(--label-primary);
        transition: border-color 0.2s, background-color 0.2s;
        white-space: nowrap;

        &:hover {
            border-color: var(--label-tertiary);
        }
    }

    &__flag {
        display: inline-flex;
        width: 20px;
        height: 15px;
        border-radius: 2px;
        overflow: hidden;
        flex-shrink: 0;
        box-shadow: 0 0 0 1px var(--separator-secondary);

        :deep(svg) {
            width: 100%;
            height: 100%;
            display: block;
        }
    }

    &__code {
        line-height: 1;
    }

    &__chevron {
        width: 14px;
        height: 14px;
        color: var(--label-tertiary);
        transition: transform 0.2s;

        &--open {
            transform: rotate(180deg);
        }
    }

    &__menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        min-width: 168px;
        margin: 0;
        padding: 4px;
        list-style: none;
        border-radius: 10px;
        border: 1px solid var(--separator-primary);
        background-color: var(--background-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
        z-index: 100;
    }

    &__item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 10px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        color: var(--label-secondary);
        transition: background-color 0.15s, color 0.15s;

        &:hover {
            background-color: var(--fill-tertiary);
            color: var(--label-primary);
        }

        &--active {
            color: var(--label-primary);
        }
    }

    &__name {
        flex-grow: 1;
    }

    &__check {
        width: 16px;
        height: 16px;
        color: var(--accent-primary);
        flex-shrink: 0;
    }
}

.locale-fade-enter-active,
.locale-fade-leave-active {
    transition: opacity 0.15s, transform 0.15s;
}
.locale-fade-enter-from,
.locale-fade-leave-to {
    opacity: 0;
    transform: translateY(-4px);
}
</style>
