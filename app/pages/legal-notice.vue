<template>
    <LegalPage v-bind="notice" />
</template>

<script setup>
import { useLegalNotice as useLegalNoticeEn } from '~~/data/legal.en'
import { useLegalNotice as useLegalNoticeFr } from '~~/data/legal.fr'

definePageMeta({
    layout: 'doc',
})

const { locale } = useLocale()
const notice = computed(() => (locale.value === 'fr' ? useLegalNoticeFr() : useLegalNoticeEn()))

useHead({
    title: 'Legal Notice — NestorCut',
    meta: [
        {
            name: 'description',
            content:
                'Legal notice of NestorCut: publisher identity, hosting, and information required under French law (LCEN).',
        },
    ],
})
</script>
