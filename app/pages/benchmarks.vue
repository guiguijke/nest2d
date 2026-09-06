<template>
    <div class="bench">
        <h1 class="bench__title">{{ isFr ? 'Benchmarks publics' : 'Public benchmarks' }}</h1>
        <p class="bench__lead">
            {{ isFr
                ? 'Nos densités de nesting, mesurées sur notre corpus de cas limites — méthode ouverte, chiffres reproductibles.'
                : 'Our nesting densities, measured on our corpus of edge cases — open method, reproducible numbers.' }}
        </p>

        <!-- Conditions datées : machine + version exacte des chiffres. -->
        <p class="bench__meta">
            {{ isFr ? 'Conditions du run' : 'Run conditions' }} :
            {{ BENCHMARKS.meta.machine[isFr ? 'fr' : 'en'] }} —
            {{ isFr ? 'images Docker du commit' : 'Docker images from commit' }}
            <code>{{ BENCHMARKS.meta.version }}</code>,
            {{ BENCHMARKS.meta.runDate }}.
        </p>

        <section class="bench__section">
            <h2>{{ isFr ? 'Méthode' : 'Method' }}</h2>
            <p class="bench__text">{{ BENCHMARKS.meta.method[isFr ? 'fr' : 'en'] }}</p>
        </section>

        <section class="bench__section">
            <h2>{{ isFr ? 'Résultats par cas' : 'Results by case' }}</h2>
            <div class="bench__tablewrap">
                <table class="bench__table">
                    <thead>
                        <tr>
                            <th>{{ isFr ? 'Cas' : 'Case' }}</th>
                            <th>{{ isFr ? 'Géométrie' : 'Geometry' }}</th>
                            <th>{{ isFr ? 'Tôles' : 'Sheets' }}</th>
                            <th>{{ isFr ? 'Espacement' : 'Spacing' }}</th>
                            <th>{{ isFr ? 'Pièces' : 'Parts' }}</th>
                            <th>{{ isFr ? 'Densité matière' : 'Material density' }}</th>
                            <th>{{ isFr ? 'Physique' : 'Physics' }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="c in BENCHMARKS.cases" :key="c.id">
                            <td class="bench__case">T-{{ c.id }}</td>
                            <td class="bench__geom">{{ c.geometry[isFr ? 'fr' : 'en'] }}</td>
                            <td>{{ c.sheets }}</td>
                            <td>{{ fmtSp(c.spaceMm) }}</td>
                            <td>
                                <template v-if="c.verdict === 'refused'">{{ isFr ? 'refusé avant calcul' : 'refused before compute' }}</template>
                                <template v-else>{{ c.placed }}/{{ c.requested }}</template>
                            </td>
                            <td class="bench__density">
                                <template v-if="c.densityPct != null">{{ fmtPct(c.densityPct) }}</template>
                                <template v-else>—</template>
                            </td>
                            <td>
                                <span v-if="c.verdict === 'ok'" class="bench__badge bench__badge--ok">
                                    {{ isFr ? 'vérifiée' : 'verified' }}
                                </span>
                                <span v-else-if="c.verdict === 'partial'" class="bench__badge bench__badge--partial">
                                    {{ isFr ? `partielle · ${c.requested - c.placed} non posée` : `partial · ${c.requested - c.placed} unplaced` }}
                                </span>
                                <span v-else-if="c.verdict === 'refused'" class="bench__badge bench__badge--refused">
                                    {{ isFr ? 'refus honnête < 1 s' : 'honest refusal < 1 s' }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p class="bench__note">
                {{ isFr
                    ? '« Vérifiée » = zéro recouvrement mesuré, toutes les pièces dans leur tôle, écart minimal jamais inférieur à l’espacement demandé.'
                    : '“Verified” = zero measured overlap, every part inside its sheet, minimal gap never below the requested spacing.' }}
            </p>
        </section>

        <section class="bench__section">
            <h2>{{ isFr ? 'Robustesse au-delà des chiffres' : 'Robustness beyond the numbers' }}</h2>
            <p class="bench__text">{{ BENCHMARKS.robustness[isFr ? 'fr' : 'en'] }}</p>
            <p class="bench__text">{{ BENCHMARKS.honesty[isFr ? 'fr' : 'en'] }}</p>
        </section>
    </div>
</template>

<script setup>
import { BENCHMARKS } from '~~/data/benchmarks'

// 3.9 : page publique — reconnaît la session (nav cohérente) sans forcer
// la connexion.
definePageMeta({
    layout: 'doc',
    middleware: 'auth-optional',
})

const { locale, fmtPercent } = useLocale()
const isFr = computed(() => locale.value === 'fr')
const fmtSp = (mm) => (isFr.value ? `${String(mm).replace('.', ',')} mm` : `${mm} mm`)
const fmtPct = (v) => fmtPercent(v)

useHead({
    title: 'Benchmarks — NestorCut',
    meta: [
        {
            name: 'description',
            content:
                'NestorCut nesting densities on a public corpus of edge cases — open method, verified physics, reproducible numbers.',
        },
    ],
})
</script>

<style lang="scss" scoped>
.bench {
    max-width: 980px;

    &__title {
        font-size: 26px;
        margin-bottom: 6px;
    }

    &__lead {
        font-size: 15px;
        color: var(--label-secondary);
        margin-bottom: 8px;
    }

    &__meta {
        font-size: 13px;
        color: var(--label-tertiary);
        margin-bottom: 18px;

        code {
            background-color: var(--fill-tertiary);
            border-radius: 4px;
            padding: 1px 5px;
            font-size: 12px;
        }
    }

    &__section {
        margin-bottom: 26px;

        h2 {
            font-size: 19px;
            margin-bottom: 8px;
        }
    }

    &__text {
        font-size: 14px;
        line-height: 1.6;
        color: var(--label-secondary);
    }

    &__tablewrap {
        overflow-x: auto;
        border: 1px solid var(--separator-secondary);
        border-radius: 10px;
    }

    &__table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        min-width: 760px;

        th,
        td {
            text-align: left;
            padding: 9px 12px;
            border-bottom: 1px solid var(--separator-secondary);
            vertical-align: top;
        }

        th {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: var(--label-tertiary);
            background-color: var(--fill-tertiary);
        }

        tbody tr:last-child td {
            border-bottom: none;
        }
    }

    &__case {
        font-weight: 700;
        white-space: nowrap;
    }

    &__geom {
        color: var(--label-secondary);
        max-width: 320px;
    }

    &__density {
        font-weight: 700;
        white-space: nowrap;
    }

    &__badge {
        display: inline-block;
        padding: 2px 9px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 700;
        white-space: nowrap;

        &--ok {
            color: var(--accent-primary);
            background-color: color-mix(in srgb, var(--accent-primary) 10%, transparent);
        }

        &--partial {
            color: var(--warning, #d97706);
            background-color: color-mix(in srgb, var(--warning, #d97706) 12%, transparent);
        }

        &--refused {
            color: var(--label-secondary);
            background-color: var(--fill-tertiary);
        }
    }

    &__note {
        font-size: 12.5px;
        color: var(--label-tertiary);
        margin-top: 8px;
    }
}
</style>
