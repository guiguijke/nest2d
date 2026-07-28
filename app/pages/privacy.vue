<template>
    <LegalPage v-bind="privacy" />
</template>

<script setup>
import { usePrivacy } from '~~/data/legal.en'

definePageMeta({
    layout: 'doc',
})

const privacy = usePrivacy()

useHead({
    title: 'Privacy Policy — APlasma Nesting',
    meta: [
        {
            name: 'description',
            content:
                'How APlasma Nesting collects, uses and protects your personal data.',
        },
    ],
})
</script>
