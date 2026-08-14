<template>
    <svg
        v-if="w && h"
        :viewBox="viewBox"
        class="sheet-preview"
        preserveAspectRatio="xMidYMid meet"
        role="img"
    >
        <g :transform="transform">
            <image
                :href="src"
                x="0"
                y="0"
                :width="w"
                :height="h"
                preserveAspectRatio="none"
            />
        </g>
        <SheetAxes :width="w" :height="h" />
    </svg>
    <img
        v-else
        :src="src"
        class="sheet-preview sheet-preview--raw"
        alt=""
    />
</template>

<script setup>
import { sheetDisplaySize, sheetLandscapeTransform } from '~/utils/sheetView'

const props = defineProps({
    src: { type: String, required: true },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
})

const w = computed(() => Number(props.width) || 0)
const h = computed(() => Number(props.height) || 0)
const viewBox = computed(() => {
    const { viewW, viewH } = sheetDisplaySize(w.value, h.value)
    return `0 0 ${viewW} ${viewH}`
})
const transform = computed(() => sheetLandscapeTransform(w.value, h.value))
</script>

<style scoped>
.sheet-preview {
    display: block;
    width: 100%;
    height: 100%;
    background: #ffffff;
}
.sheet-preview--raw {
    object-fit: contain;
}
</style>
