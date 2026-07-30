<script setup lang="ts">
    // Reusable compact table for nesting/strip jobs.
    // Used on the user detail page and the activity page.
    defineProps<{
        jobs: any[]
        showUser?: boolean
        compact?: boolean
    }>()

    function fmtDate(d: any) {
        return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'
    }
    function fmtTime(d: any) {
        return d ? new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
    }
    // Real duration in seconds from startAt→finishedAt, else fall back to timeTaken (minutes).
    function duration(j: any): string {
        if (j.startAt && j.finishedAt) {
            const s = Math.max(0, Math.round((new Date(j.finishedAt).getTime() - new Date(j.startAt).getTime()) / 1000))
            if (s < 60) return s + 's'
            const m = Math.floor(s / 60)
            return m + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '')
        }
        if (j.timeTaken) return j.timeTaken + 'm'
        return '—'
    }
    function statusCls(s: string) {
        switch (s) {
            case 'done':
                return 'bg-ok/15 text-ok'
            case 'processing':
            case 'pending':
                return 'bg-warn/15 text-warn'
            case 'error':
            case 'failed':
                return 'bg-err/15 text-err'
            default:
                return 'bg-marine-700 text-ink-300'
        }
    }
    function chargeLabel(c: any): string {
        if (!c || !c.type) return '—'
        const map: Record<string, string> = { grant: 'offert', subscription: 'abo', free: 'gratuit' }
        return map[c.type] || c.type
    }
    function density(j: any): string {
        if (j.density == null) return '—'
        return Math.round(j.density * 100) + '%'
    }
</script>

<template>
    <div class="overflow-x-auto">
        <table class="w-full text-xs">
            <thead class="text-left text-ink-400">
                <tr>
                    <th class="px-2 py-1.5 font-medium">Date</th>
                    <th
                        v-if="!compact"
                        class="px-2 py-1.5 font-medium"
                    >
                        Système
                    </th>
                    <th class="px-2 py-1.5 font-medium">Statut</th>
                    <th class="px-2 py-1.5 font-medium text-right">Durée</th>
                    <th class="px-2 py-1.5 font-medium text-right">Densité</th>
                    <th class="px-2 py-1.5 font-medium text-right">Pièces</th>
                    <th
                        v-if="!compact"
                        class="px-2 py-1.5 font-medium text-right"
                    >
                        Niveau
                    </th>
                    <th
                        v-if="!compact"
                        class="px-2 py-1.5 font-medium"
                    >
                        Facturé
                    </th>
                </tr>
            </thead>
            <tbody>
                <tr
                    v-for="(j, i) in jobs"
                    :key="i"
                    class="border-t border-marine-800"
                >
                    <td class="px-2 py-1.5 whitespace-nowrap text-ink-300">
                        {{ fmtDate(j.finishedAt || j.createdAt) }}
                        <span class="text-ink-400">{{ fmtTime(j.finishedAt || j.createdAt) }}</span>
                    </td>
                    <td
                        v-if="!compact"
                        class="px-2 py-1.5"
                    >
                        <span class="badge bg-marine-700 text-ink-300">{{ j.system }}</span>
                    </td>
                    <td class="px-2 py-1.5">
                        <span
                            class="badge"
                            :class="statusCls(j.status)"
                            >{{ j.status }}</span
                        >
                    </td>
                    <td class="px-2 py-1.5 text-right font-mono text-ink-200">{{ duration(j) }}</td>
                    <td class="px-2 py-1.5 text-right font-mono text-ink-300">{{ density(j) }}</td>
                    <td class="px-2 py-1.5 text-right font-mono text-ink-300">
                        {{ j.placed ?? '—'
                        }}<span
                            v-if="j.requested"
                            class="text-ink-400"
                            >/{{ j.requested }}</span
                        >
                    </td>
                    <td
                        v-if="!compact"
                        class="px-2 py-1.5 text-right font-mono text-ink-400"
                    >
                        {{ j.params?.computeLevel || '—' }}
                    </td>
                    <td
                        v-if="!compact"
                        class="px-2 py-1.5"
                    >
                        <span class="badge bg-marine-700 text-ink-300">{{ chargeLabel(j.charge) }}</span>
                    </td>
                </tr>
                <tr v-if="!jobs.length">
                    <td
                        :colspan="compact ? 6 : 8"
                        class="px-2 py-4 text-center text-ink-400"
                    >
                        Aucun job.
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</template>
