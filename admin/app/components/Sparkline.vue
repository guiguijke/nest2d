<script setup lang="ts">
// Minimal dependency-free bar sparkline from a {date,count}[] series.
const props = defineProps<{
  data: { date: string; count: number }[]
  height?: number
}>()

const max = computed(() => Math.max(1, ...props.data.map((d) => d.count)))
</script>

<template>
  <div class="flex items-end gap-[2px]" :style="{ height: (height || 48) + 'px' }">
    <template v-if="data.length">
      <div
        v-for="d in data"
        :key="d.date"
        :title="`${d.date}: ${d.count}`"
        class="flex-1 rounded-sm bg-rust/60 transition-all hover:bg-rust"
        :style="{ height: Math.max(2, (d.count / max) * (height || 48)) + 'px' }"
      />
    </template>
    <span v-else class="text-[11px] text-ink-400">Aucune donnée</span>
  </div>
</template>
