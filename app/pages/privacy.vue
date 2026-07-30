<template>
    <LegalPage v-bind="privacy" />
</template>

<script setup>
import { usePrivacy as usePrivacyEn } from '~~/data/legal.en'
import { usePrivacy as usePrivacyFr } from '~~/data/legal.fr'

definePageMeta({
    layout: 'doc',
})

const { locale } = useLocale()
const privacy = computed(() => (locale.value === 'fr' ? usePrivacyFr() : usePrivacyEn()))

useHead({
    title: 'Privacy Policy — NestorCut',
    meta: [
        {
            name: 'description',
            content:
                'How NestorCut collects, uses and protects your personal data.',
        },
    ],
})
</script>
