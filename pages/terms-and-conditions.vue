<template>
    <LegalPage v-bind="terms" />
</template>

<script setup>
import { useTerms } from '~~/data/legal.en'

definePageMeta({
    layout: 'doc',
})

const terms = useTerms()

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
