<template>
    <LegalPage v-bind="refund" />
</template>

<script setup>
import { useRefund as useRefundPolicy } from '~~/data/legal.en'

definePageMeta({
    layout: 'doc',
})

const refund = useRefundPolicy()

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
