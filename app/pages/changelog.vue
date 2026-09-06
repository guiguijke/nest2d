<template>
    <div class="changelog">
        <header class="changelog__header">
            <h1 class="changelog__title">Changelog</h1>
            <p class="changelog__subtitle">
                What changed in NestorCut, newest first.
            </p>
        </header>

        <article
            v-for="(post, postIndex) in posts"
            :key="postIndex"
            class="changelog__entry entry"
        >
            <header class="entry__header">
                <time :datetime="post.datetime" class="entry__date">
                    {{ formatDate(post.datetime) }}
                </time>
                <h2 class="entry__title">{{ post.title }}</h2>
            </header>
            <div
                v-for="(section, sectionIndex) in post.sections"
                :key="sectionIndex"
                class="entry__section"
            >
                <h3 v-if="section.title" class="entry__section-title">
                    {{ section.title }}
                </h3>
                <ul v-if="Array.isArray(section.content)" class="entry__list">
                    <li
                        v-for="(item, itemIndex) in section.content"
                        :key="itemIndex"
                        class="entry__item"
                    >
                        {{ item }}
                    </li>
                </ul>
                <p v-else class="entry__text">{{ section.content }}</p>
            </div>
        </article>
    </div>
</template>

<script setup>
import { useChangelog } from "~~/data/changelog";

definePageMeta({
    layout: "doc",
    // 3.1.6 : publique, mais reconnaît la session (nav cohérente).
    middleware: "auth-optional",
});

const posts = useChangelog();

const formatDate = (iso) => {
    return new Date(iso).toLocaleDateString("en-GB", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
};

onMounted(() => {
    trackEvent('page_view', { page: 'changelog' })
});
</script>

<style lang="scss" scoped>
.changelog {
    max-width: 760px;
    margin: 0 auto;
    padding: 16px;

    &__header {
        text-align: center;
        margin-bottom: 40px;
    }

    &__title {
        color: var(--accent-primary);
        font-size: 2rem;
        font-weight: 700;

        @media (min-width: 567px) {
            font-size: 2.5rem;
        }
    }

    &__subtitle {
        margin-top: 12px;
        color: var(--label-secondary);
    }
}

.entry {
    border: 1px solid var(--separator-secondary);
    border-radius: 16px;
    padding: 24px;
    background-color: var(--fill-tertiary);

    &:not(:last-child) {
        margin-bottom: 24px;
    }

    &__header {
        margin-bottom: 16px;
    }

    &__date {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 999px;
        background-color: var(--fill-secondary);
        color: var(--accent-primary);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.03em;
    }

    &__title {
        margin-top: 12px;
        color: var(--label-primary);
        font-size: 20px;
        font-weight: 700;
    }

    &__section {
        &:not(:last-child) {
            margin-bottom: 16px;
        }
    }

    &__section-title {
        color: var(--label-primary);
        font-size: 15px;
        font-weight: 700;
        margin-bottom: 8px;
    }

    &__list {
        padding-left: 4px;
    }

    &__item {
        position: relative;
        padding-left: 18px;
        color: var(--label-secondary);
        font-size: 14px;
        line-height: 1.6;

        &:not(:last-child) {
            margin-bottom: 6px;
        }

        &::before {
            content: '';
            position: absolute;
            left: 0;
            top: 9px;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background-color: var(--accent-primary);
        }
    }

    &__text {
        color: var(--label-secondary);
        font-size: 14px;
        line-height: 1.6;
    }
}
</style>
