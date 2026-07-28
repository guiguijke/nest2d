<template>
    <article class="legal">
        <header class="legal__header">
            <h1 class="legal__title">{{ title }}</h1>
            <p v-if="subtitle" class="legal__subtitle">{{ subtitle }}</p>
            <p v-if="effectiveDate" class="legal__meta">
                {{ lastUpdatedLabel }} {{ effectiveDate }}
            </p>
        </header>

        <section
            v-for="(section, index) in sections"
            :key="index"
            class="legal__section"
        >
            <h2 class="legal__heading">{{ section.heading }}</h2>
            <p
                v-for="(paragraph, pIndex) in section.paragraphs"
                :key="pIndex"
                class="legal__paragraph"
            >
                {{ paragraph }}
            </p>
            <ul v-if="section.list" class="legal__list">
                <li v-for="(item, lIndex) in section.list" :key="lIndex" class="legal__list-item">
                    {{ item }}
                </li>
            </ul>
        </section>

        <footer v-if="contact" class="legal__contact">
            <p class="legal__paragraph">
                {{ contact.intro }}
                <a :href="`mailto:${contact.email}`" class="legal__link">{{ contact.email }}</a>
                <template v-if="contact.outro">{{ contact.outro }}</template>
            </p>
        </footer>
    </article>
</template>

<script setup>
defineProps({
    title: { type: String, required: true },
    subtitle: { type: String, default: '' },
    lastUpdatedLabel: { type: String, default: 'Last updated:' },
    effectiveDate: { type: String, default: '' },
    sections: { type: Array, required: true },
    contact: { type: Object, default: null },
})
</script>

<style lang="scss" scoped>
.legal {
    max-width: 760px;
    margin: 0 auto;
    color: var(--label-primary);
    line-height: 1.7;

    &__header {
        margin-bottom: 40px;
        padding-bottom: 24px;
        border-bottom: 1px solid var(--separator-primary);
    }

    &__title {
        font-size: 32px;
        font-weight: 700;
        margin: 0 0 12px;
        color: var(--label-primary);
    }

    &__subtitle {
        font-size: 16px;
        color: var(--label-secondary);
        margin: 0;
    }

    &__meta {
        font-size: 13px;
        color: var(--label-tertiary);
        margin: 16px 0 0;
    }

    &__section {
        margin-bottom: 36px;

        &:last-of-type {
            margin-bottom: 0;
        }
    }

    &__heading {
        font-size: 20px;
        font-weight: 600;
        margin: 0 0 16px;
        color: var(--label-primary);
    }

    &__paragraph {
        font-size: 15px;
        margin: 0 0 14px;
        color: var(--label-secondary);

        &:last-child {
            margin-bottom: 0;
        }
    }

    &__list {
        margin: 0 0 14px;
        padding-left: 20px;
    }

    &__list-item {
        font-size: 15px;
        color: var(--label-secondary);
        margin-bottom: 8px;
        list-style-type: disc;

        &:last-child {
            margin-bottom: 0;
        }
    }

    &__contact {
        margin-top: 40px;
        padding-top: 24px;
        border-top: 1px solid var(--separator-primary);
    }

    &__link {
        color: var(--accent-primary);
        text-decoration: underline;
        font-weight: 600;

        @media (hover: hover) {
            &:hover {
                color: var(--accent-secondary);
            }
        }
    }
}
</style>
