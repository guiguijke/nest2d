<template>
    <div class="licences">
        <h1 class="licences__title">
            {{ t('licences.title') }}
        </h1>
        <h2 class="licences__subtitle">
            {{ t('licences.subtitle') }}
        </h2>
        <p class="licences__text">
            {{ t('licences.text') }}
        </p>
        <section
            v-for="group in groups"
            :key="group.id"
            class="licences__group"
        >
            <h3 class="licences__group-title">
                {{ t(`licences.group.${group.id}`) }}
            </h3>
            <div class="licences__table-wrapper">
                <table class="licences__table">
                    <thead>
                        <tr>
                            <th>{{ t('licences.col.package') }}</th>
                            <th>{{ t('licences.col.version') }}</th>
                            <th>{{ t('licences.col.license') }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="pkg in group.packages"
                            :key="pkg.name"
                        >
                            <td>
                                {{ pkg.name }}
                                <div
                                    v-if="pkg.note"
                                    class="licences__note"
                                >
                                    {{ pkg.note }}
                                </div>
                            </td>
                            <td>{{ pkg.version }}</td>
                            <td>{{ pkg.license }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </div>
</template>

<script setup>
import { groups } from "~~/data/licences";
const { t } = useLocale()
definePageMeta({
    layout: "doc",
});
</script>

<style lang="scss" scoped>
.licences {
    max-width: 900px;
    margin: 0 auto;
    padding: 16px;
    color: var(--label-secondary);

    &__title {
        color: var(--accent-primary);
        font-size: 1.75rem;
        font-weight: 700;
        margin-bottom: 24px;
    }

    &__subtitle {
        color: var(--label-primary);
        font-size: 1.25rem;
        font-weight: 700;
        margin-bottom: 12px;
    }

    &__text {
        margin-bottom: 24px;
        font-size: 15px;
    }

    &__group {
        margin-bottom: 32px;
    }

    &__group-title {
        color: var(--label-primary);
        font-size: 1.05rem;
        font-weight: 700;
        margin-bottom: 10px;
    }

    &__note {
        color: var(--label-tertiary);
        font-size: 12px;
        font-weight: 400;
    }

    &__table-wrapper {
        border: 1px solid var(--separator-secondary);
        border-radius: 12px;
        overflow-x: auto;
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
        min-width: 560px;

        th, td {
            padding: 10px 14px;
            text-align: left;
        }

        thead th {
            color: var(--label-primary);
            font-weight: 700;
            background-color: var(--fill-secondary);
            border-bottom: 1px solid var(--separator-primary);
        }

        tbody tr:not(:last-child) td {
            border-bottom: 1px solid var(--separator-secondary);
        }
    }
}
</style>
