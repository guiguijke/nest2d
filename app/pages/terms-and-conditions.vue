<template>
    <LegalPage v-bind="terms" />
</template>

<script setup>
import { useTerms as useTermsEn } from '~~/data/legal.en'
import { useTerms as useTermsFr } from '~~/data/legal.fr'

definePageMeta({
    layout: 'doc',
})

const { locale } = useLocale()
const terms = computed(() => (locale.value === 'fr' ? useTermsFr() : useTermsEn()))

useHead({
    title: 'Terms and Conditions — APlasma Nesting',
    meta: [
        {
            name: 'description',
            content: 'Terms and Conditions governing the use of APlasma Nesting.',
        },
    ],
})
</script>
