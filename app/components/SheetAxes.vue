<template>
    <g class="axes" aria-hidden="true">
        <defs>
            <marker
                :id="ids.x"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="3.6"
                markerHeight="3.6"
                orient="auto"
                markerUnits="strokeWidth"
            >
                <path d="M0.4 1.3 L9.2 5 L0.4 8.7 Z" fill="#b42318" />
            </marker>
            <marker
                :id="ids.y"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="3.6"
                markerHeight="3.6"
                orient="auto"
                markerUnits="strokeWidth"
            >
                <path d="M0.4 1.3 L9.2 5 L0.4 8.7 Z" fill="#027a48" />
            </marker>
        </defs>

        <line
            :x1="shaft(axes.origin, axes.xTo).x"
            :y1="shaft(axes.origin, axes.xTo).y"
            :x2="axes.xTo.x"
            :y2="axes.xTo.y"
            class="axes__halo"
        />
        <line
            :x1="shaft(axes.origin, axes.yTo).x"
            :y1="shaft(axes.origin, axes.yTo).y"
            :x2="axes.yTo.x"
            :y2="axes.yTo.y"
            class="axes__halo"
        />

        <line
            :x1="shaft(axes.origin, axes.xTo).x"
            :y1="shaft(axes.origin, axes.xTo).y"
            :x2="axes.xTo.x"
            :y2="axes.xTo.y"
            class="axes__line axes__line--x"
            :marker-end="`url(#${ids.x})`"
        />
        <line
            :x1="shaft(axes.origin, axes.yTo).x"
            :y1="shaft(axes.origin, axes.yTo).y"
            :x2="axes.yTo.x"
            :y2="axes.yTo.y"
            class="axes__line axes__line--y"
            :marker-end="`url(#${ids.y})`"
        />

        <circle
            :cx="axes.origin.x"
            :cy="axes.origin.y"
            :r="dot"
            class="axes__origin"
        />

        <text
            :x="xLabel.x"
            :y="xLabel.y"
            class="axes__label axes__label--x"
            :font-size="font"
            text-anchor="middle"
            dominant-baseline="middle"
        >{{ t('sheet.axisX') }}</text>
        <text
            :x="yLabel.x"
            :y="yLabel.y"
            class="axes__label axes__label--y"
            :font-size="font"
            text-anchor="middle"
            dominant-baseline="middle"
        >{{ t('sheet.axisY') }}</text>
    </g>
</template>

<script setup>
import { axisLabelPos, sheetAxesDisplay } from '~/utils/sheetView'

const props = defineProps({
    width: { type: Number, required: true },
    height: { type: Number, required: true },
})

const { t } = useLocale()

const ids = {
    x: `ax-x-${Math.random().toString(36).slice(2, 9)}`,
    y: `ax-y-${Math.random().toString(36).slice(2, 9)}`,
}

const axes = computed(() => sheetAxesDisplay(props.width, props.height))
const font = computed(() => Math.max(axes.value.len * 0.22, 16))
const dot = computed(() => Math.max(axes.value.len * 0.032, 5))
const gap = computed(() => Math.max(axes.value.len * 0.08, 8))

const xLabel = computed(() =>
    axisLabelPos(axes.value.origin, axes.value.xTo, axes.value.viewW, axes.value.viewH, font.value),
)
const yLabel = computed(() =>
    axisLabelPos(axes.value.origin, axes.value.yTo, axes.value.viewW, axes.value.viewH, font.value),
)

function shaft(from, to) {
    const dx = to.x - from.x
    const dy = to.y - from.y
    const L = Math.hypot(dx, dy) || 1
    const g = gap.value
    return { x: from.x + (dx / L) * g, y: from.y + (dy / L) * g }
}
</script>

<style scoped>
.axes {
    pointer-events: none;
}
.axes__halo {
    fill: none;
    stroke: #ffffff;
    stroke-width: 4.5;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
}
.axes__line {
    fill: none;
    stroke-width: 1.85;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
}
.axes__line--x {
    stroke: #b42318;
}
.axes__line--y {
    stroke: #027a48;
}
.axes__origin {
    fill: #ffffff;
    stroke: #1e293b;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
}
.axes__label {
    font-weight: 600;
    font-family: Inter, system-ui, sans-serif;
    paint-order: stroke fill;
    stroke: #ffffff;
    stroke-width: 4px;
    stroke-linejoin: round;
}
.axes__label--x {
    fill: #b42318;
}
.axes__label--y {
    fill: #027a48;
}
</style>
