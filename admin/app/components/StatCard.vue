<script setup lang="ts">
defineProps<{
  label: string
  value: string | number
  hint?: string
  accent?: 'default' | 'blue' | 'ok' | 'warn' | 'err'
  live?: boolean
}>()
</script>

<template>
  <div class="card flex flex-col gap-1">
    <div class="flex items-center justify-between">
      <span class="label !mb-0">{{ label }}</span>
      <span v-if="live" class="badge bg-ok/15 text-ok">● live</span>
    </div>
    <span
      class="font-mono text-2xl font-semibold text-white"
      :class="{
        'text-blue': accent === 'blue',
        'text-ok': accent === 'ok',
        'text-warn': accent === 'warn',
        'text-err': accent === 'err',
      }"
    >
      {{ value }}
    </span>
    <span v-if="hint" class="text-[11px] text-ink-400">{{ hint }}</span>
  </div>
</template>
