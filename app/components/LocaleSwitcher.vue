<template>
    <div class="locale-switcher">
        <button
            v-for="loc in locales"
            :key="loc"
            :class="['locale-switcher__btn', { 'locale-switcher__btn--active': loc === locale }]"
            @click="setLocale(loc)"
        >
            {{ loc.toUpperCase() }}
        </button>
    </div>
</template>

<script setup>
import { LOCALES } from '~/utils/i18n'

const { locale, setLocale } = useLocale()
const locales = LOCALES
</script>

<style lang="scss" scoped>
.locale-switcher {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: 8px;

    &__btn {
        padding: 4px 6px;
        font-size: 11px;
        font-weight: 700;
        border-radius: 4px;
        color: var(--label-tertiary);
        cursor: pointer;
        transition: color 0.2s, background-color 0.2s;

        @media (hover: hover) {
            &:hover {
                color: var(--label-secondary);
                background-color: var(--fill-tertiary);
            }
        }

        &--active {
            color: var(--background-primary);
            background-color: var(--accent-primary);
        }
    }
}
</style>
