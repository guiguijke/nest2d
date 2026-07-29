<template>
    <LegalPage v-bind="refund" />
</template>

<script setup>
import { useRefund as useRefundEn } from '~~/data/legal.en'
import { useRefund as useRefundFr } from '~~/data/legal.fr'

definePageMeta({
    layout: 'doc',
})

const { locale } = useLocale()
const refund = computed(() => (locale.value === 'fr' ? useRefundFr() : useRefundEn()))

useHead({
    title: 'Refund Policy — APlasma Nesting',
    meta: [
        {
            name: 'description',
            content: 'Our 30-day money-back guarantee and refund procedure.',
        },
    ],
})
</script>
