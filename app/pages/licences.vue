<template>
    <div class="licences">
        <h1 class="licences__title">
            License Information
        </h1>
        <h2 class="licences__subtitle">
            Third-Party Licenses
        </h2>
        <p class="licences__text">
            Below is a list of third-party dependencies and their respective licenses used in this project:
        </p>
        <div class="licences__table-wrapper">
            <table class="licences__table">
                <thead>
                    <tr>
                        <th>Package</th>
                        <th>Version</th>
                        <th>License</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="pkg in packages"
                        :key="pkg.name"
                    >
                        <td>{{ pkg.name }}</td>
                        <td>{{ pkg.version }}</td>
                        <td>{{ pkg.license }}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    </div>
</template>

<script setup>
import { packages } from "~~/data/licences";
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
