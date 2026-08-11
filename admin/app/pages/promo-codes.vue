<script setup lang="ts">
    definePageMeta({ middleware: ['admin-auth'] })

    const { data, pending, error, refresh } = await useFetch('/api/promo-codes', {
        credentials: 'include',
    })

    // ── Create form ──
    const code = ref('')
    const partner = ref('')
    const freeNestingLimit = ref(20)
    const expiresAt = ref('')
    const maxRedemptions = ref('')

    const acting = ref(false)
    const lastMsg = ref('')

    async function createCode() {
        acting.value = true
        lastMsg.value = ''
        try {
            const res: any = await $fetch('/api/promo-codes', {
                method: 'POST',
                body: {
                    code: code.value,
                    partner: partner.value,
                    freeNestingLimit: freeNestingLimit.value,
                    expiresAt: expiresAt.value || null,
                    maxRedemptions: maxRedemptions.value || null,
                },
                credentials: 'include',
            })
            lastMsg.value = `✓ Code ${res.code} créé`
            code.value = ''
            partner.value = ''
            freeNestingLimit.value = 20
            expiresAt.value = ''
            maxRedemptions.value = ''
            await refresh()
        } catch (e: any) {
            lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
        } finally {
            acting.value = false
        }
    }

    async function toggle(c: any) {
        acting.value = true
        lastMsg.value = ''
        try {
            await $fetch(`/api/promo-codes/${encodeURIComponent(c.code)}`, {
                method: 'PATCH',
                body: { active: !c.active },
                credentials: 'include',
            })
            lastMsg.value = `✓ ${c.code} ${c.active ? 'désactivé' : 'activé'}`
            await refresh()
        } catch (e: any) {
            lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
        } finally {
            acting.value = false
        }
    }

    // ── Campaign renewal: sets a new end date on the code AND propagates it
    // to every existing beneficiary (server-side updateMany).
    const renewDates = ref<Record<string, string>>({})

    async function applyExpiry(c: any, isoDate: string) {
        acting.value = true
        lastMsg.value = ''
        try {
            const res: any = await $fetch(`/api/promo-codes/${encodeURIComponent(c.code)}`, {
                method: 'PATCH',
                body: { expiresAt: isoDate },
                credentials: 'include',
            })
            lastMsg.value = `✓ ${c.code} reconduit jusqu'au ${fmtDate(isoDate)} (${res.propagated} bénéficiaire(s))`
            renewDates.value[c.code] = ''
            await refresh()
        } catch (e: any) {
            lastMsg.value = `✗ ${e?.data?.statusMessage || 'Erreur'}`
        } finally {
            acting.value = false
        }
    }

    function renewCustom(c: any) {
        const val = renewDates.value[c.code]
        if (!val) {
            lastMsg.value = '✗ Choisissez une date de fin'
            return
        }
        applyExpiry(c, val)
    }

    function quickRenew(c: any, months: number) {
        // Extend from the current end date when still running, else from now.
        const base = c.expiresAt && new Date(c.expiresAt) > new Date() ? new Date(c.expiresAt) : new Date()
        base.setMonth(base.getMonth() + months)
        applyExpiry(c, base.toISOString().slice(0, 10))
    }

    function fmtDate(d: any) {
        if (!d) return '—'
        return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    }
    function isExpired(c: any) {
        return c.expiresAt && new Date(c.expiresAt) <= new Date()
    }
    function statusBadge(c: any) {
        if (!c.active) return { text: 'Inactif', cls: 'bg-marine-700 text-ink-300' }
        if (isExpired(c)) return { text: 'Expiré', cls: 'bg-err/15 text-err' }
        return { text: 'Actif', cls: 'bg-ok/15 text-ok' }
    }
</script>

<template>
    <div class="space-y-4">
        <div>
            <h1 class="text-xl">Codes promo</h1>
            <p class="text-xs text-ink-400">
                Codes partenaires : majorent le quota gratuit mensuel des utilisateurs qui les
                activent. La date d'expiration vaut pour les nouvelles activations ET les
                bénéficiaires existants — la reconduire la propage à tous. Sans expiration, le
                code est illimité. La désactivation ne bloque que les nouvelles activations.
            </p>
        </div>

        <!-- Create -->
        <div class="card space-y-3">
            <h2 class="text-sm font-semibold">Nouveau code</h2>
            <div class="flex flex-wrap items-end gap-3">
                <div class="w-full sm:w-auto">
                    <label class="label">Code</label>
                    <input
                        v-model="code"
                        class="input w-full font-mono uppercase sm:w-40"
                        placeholder="JD20"
                        maxlength="20"
                    />
                </div>
                <div class="w-full sm:w-auto">
                    <label class="label">Partenaire</label>
                    <input
                        v-model="partner"
                        class="input w-full sm:w-56"
                        placeholder="JD's Garage"
                    />
                </div>
                <div class="w-full sm:w-auto">
                    <label class="label">Nestings gratuits / mois</label>
                    <input
                        v-model.number="freeNestingLimit"
                        type="number"
                        min="1"
                        max="1000"
                        class="input w-full sm:w-32"
                    />
                </div>
                <div class="w-full sm:w-auto">
                    <label class="label">Expiration (optionnel)</label>
                    <input
                        v-model="expiresAt"
                        type="date"
                        class="input"
                    />
                </div>
                <div class="w-full sm:w-auto">
                    <label class="label">Max utilisations (optionnel)</label>
                    <input
                        v-model="maxRedemptions"
                        type="number"
                        min="1"
                        class="input w-full sm:w-36"
                        placeholder="illimité"
                    />
                </div>
                <button
                    class="btn-primary w-full sm:w-auto"
                    :disabled="acting"
                    @click="createCode"
                >
                    Créer
                </button>
            </div>
            <p
                v-if="lastMsg"
                class="text-xs text-ink-200"
            >
                {{ lastMsg }}
            </p>
        </div>

        <!-- List -->
        <div
            v-if="pending && !data"
            class="text-sm text-ink-400"
        >
            Chargement…
        </div>
        <div
            v-else-if="error"
            class="card border-err/40 text-sm text-err"
        >
            Erreur : {{ error.statusMessage }}
        </div>

        <template v-else-if="data">
            <!-- Desktop table -->
            <div class="card overflow-x-auto p-0 hidden md:block">
                <table class="w-full text-xs">
                    <thead class="border-b border-marine-700 text-left text-ink-400">
                        <tr>
                            <th class="px-3 py-2 font-medium">Code</th>
                            <th class="px-3 py-2 font-medium">Partenaire</th>
                            <th class="px-3 py-2 font-medium">Limite</th>
                            <th class="px-3 py-2 font-medium">Utilisations</th>
                            <th class="px-3 py-2 font-medium">Statut</th>
                            <th class="px-3 py-2 font-medium">Expiration</th>
                            <th class="px-3 py-2 font-medium">Reconduire</th>
                            <th class="px-3 py-2 font-medium">Créé le</th>
                            <th class="px-3 py-2 font-medium"></th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="c in data.items"
                            :key="c.code"
                            class="border-b border-marine-800 last:border-0"
                        >
                            <td class="px-3 py-2 font-mono font-medium text-white">{{ c.code }}</td>
                            <td class="px-3 py-2 text-ink-300">{{ c.partner }}</td>
                            <td class="px-3 py-2 text-ink-300">{{ c.freeNestingLimit }}/mois</td>
                            <td class="px-3 py-2 text-ink-300">
                                {{ c.redemptionCount || 0
                                }}{{ c.maxRedemptions ? ` / ${c.maxRedemptions}` : '' }}
                            </td>
                            <td class="px-3 py-2">
                                <span
                                    class="badge"
                                    :class="statusBadge(c).cls"
                                    >{{ statusBadge(c).text }}</span
                                >
                            </td>
                            <td class="px-3 py-2 text-ink-300">{{ fmtDate(c.expiresAt) }}</td>
                            <td class="px-3 py-2">
                                <div class="flex items-center gap-1">
                                    <input
                                        v-model="renewDates[c.code]"
                                        type="date"
                                        class="input input-xs w-32"
                                        @keyup.enter="renewCustom(c)"
                                    />
                                    <button
                                        class="btn-secondary"
                                        :disabled="acting"
                                        title="Appliquer la date choisie"
                                        @click="renewCustom(c)"
                                    >
                                        OK
                                    </button>
                                    <button
                                        class="btn-secondary"
                                        :disabled="acting"
                                        @click="quickRenew(c, 3)"
                                    >
                                        +3 mois
                                    </button>
                                    <button
                                        class="btn-secondary"
                                        :disabled="acting"
                                        @click="quickRenew(c, 6)"
                                    >
                                        +6 mois
                                    </button>
                                </div>
                            </td>
                            <td class="px-3 py-2 text-ink-300">{{ fmtDate(c.createdAt) }}</td>
                            <td class="px-3 py-2 text-right">
                                <button
                                    class="btn-secondary"
                                    :disabled="acting"
                                    @click="toggle(c)"
                                >
                                    {{ c.active ? 'Désactiver' : 'Activer' }}
                                </button>
                            </td>
                        </tr>
                        <tr v-if="!data.items.length">
                            <td
                                colspan="9"
                                class="px-3 py-6 text-center text-ink-400"
                            >
                                Aucun code promo.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Mobile cards -->
            <div class="space-y-2 md:hidden">
                <div
                    v-for="c in data.items"
                    :key="c.code"
                    class="card space-y-2 p-3 text-xs"
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-mono font-medium text-white">{{ c.code }}</span>
                        <span
                            class="badge"
                            :class="statusBadge(c).cls"
                            >{{ statusBadge(c).text }}</span
                        >
                    </div>
                    <div class="space-y-1.5">
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Partenaire</span>
                            <span class="text-ink-300">{{ c.partner }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Limite</span>
                            <span class="text-ink-300">{{ c.freeNestingLimit }}/mois</span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Utilisations</span>
                            <span class="text-ink-300">
                                {{ c.redemptionCount || 0
                                }}{{ c.maxRedemptions ? ` / ${c.maxRedemptions}` : '' }}
                            </span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Expiration</span>
                            <span class="text-ink-300">{{ fmtDate(c.expiresAt) }}</span>
                        </div>
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-ink-400">Créé le</span>
                            <span class="text-ink-300">{{ fmtDate(c.createdAt) }}</span>
                        </div>
                    </div>
                    <div class="space-y-1.5 border-t border-marine-800 pt-2">
                        <span class="text-ink-400">Reconduire</span>
                        <div class="flex flex-wrap items-center gap-1">
                            <input
                                v-model="renewDates[c.code]"
                                type="date"
                                class="input input-xs w-32"
                                @keyup.enter="renewCustom(c)"
                            />
                            <button
                                class="btn-secondary"
                                :disabled="acting"
                                title="Appliquer la date choisie"
                                @click="renewCustom(c)"
                            >
                                OK
                            </button>
                            <button
                                class="btn-secondary"
                                :disabled="acting"
                                @click="quickRenew(c, 3)"
                            >
                                +3 mois
                            </button>
                            <button
                                class="btn-secondary"
                                :disabled="acting"
                                @click="quickRenew(c, 6)"
                            >
                                +6 mois
                            </button>
                        </div>
                    </div>
                    <button
                        class="btn-secondary w-full"
                        :disabled="acting"
                        @click="toggle(c)"
                    >
                        {{ c.active ? 'Désactiver' : 'Activer' }}
                    </button>
                </div>
                <p
                    v-if="!data.items.length"
                    class="card p-3 text-center text-xs text-ink-400"
                >
                    Aucun code promo.
                </p>
            </div>
        </template>
    </div>
</template>
