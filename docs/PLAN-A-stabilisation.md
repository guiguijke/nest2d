# Plan d’implémentation — Phase A (stabilisation)

Date : 2026-08-30  
Parent : `docs/PLAN-coupe-commune.md`  
Statut : **livré 2026-08-31** (isolation live + champion + pastille
« calcul en cours » ; vitest 330). **Pas de kerf / CLC.**

Objectif : un `main` dont on peut dire « navigation + live + filet verts », avant le refactor params (B).

Git au 2026-08-30 : branche `main`, working tree **propre** hors untracked (`.qa-pw/`, `.testparts/`, `bench/`, scripts QA, `docs/PLAN-coupe-commune.md`). L’audit 29 août **est déjà commité** (`a363a9f` … `6d940da`). Le « 79 fichiers non commités » du PLAN-coupe-commune est **périmé** — A.0 = constater ça, ne pas re-merger.

---

## Constat : deux cloisonnements différents

| Quoi | État | Preuve |
|---|---|---|
| Réglages (tôles, space, quantités) | Livré §O audit, snapshots `files.js` | Commits `5097289` / `d663ab8` / `6d940da` |
| **Calcul + vue live** | **Cassé** | Tu vois le nesting de A sur B ; A a l’air reset |

Le registre (`localSolverRegistry`) **voulait** isoler les solves. La page **se trompe de job** et **réécrit le propriétaire**.

Locker la navigation n’est **pas** le plan A. L’isolation est possible. Le lock n’est qu’un filet si un cas reste non isolable (Free, 1 nest) — pas le défaut.

---

## Causes racines (code lu)

### 1. `ensureJob` vole le `projectSlug`

```123:126:Nestorcut/app/composables/localSolverRegistry.js
    if (existing && ['queued', 'running', 'done'].includes(existing.phase)) {
        existing.projectSlug = projectSlug || existing.projectSlug
        return readonly(existing)
    }
```

Re-subscribe (navigation / `watch` immediate) **écrase** le projet d’origine.

### 2. La page B s’abonne au job `awaiting_local` **global**, pas au sien

```234:252:Nestorcut/app/pages/project/[slug].vue
watch(
    () => (unref(resultsList) || []).find((r) => r.status === 'awaiting_local'),
    async (job) => {
        ...
        ensureJob(job, {
            projectSlug: route.params.slug,  // page COURANTE, pas le job
```

`UserResults` vit dans le **layout** (survit à la nav). Au clic A→B :

1. Page B monte tout de suite (`immediate: true`).
2. `resultsList` contient **encore** les jobs de A (SSE de B pas reconnecté).
3. `find(awaiting_local)` = job de A.
4. `ensureJob(jobA, { projectSlug: 'B' })` → le job A est maintenant étiqueté B.
5. `progressFor('B')` affiche la frame de A. `progressFor('A')` ne voit plus rien → A « reset ».

### 3. Live / bouton « calcul » non filtrés

```156:165:Nestorcut/app/pages/project/[slug].vue
const liveResult = computed(() => {
    const list = unref(resultsList) || [];
    return list.find((r) => r.liveLayout) || null;
});
const runningJob = computed(() => {
    const list = unref(resultsList) || [];
    return list.find((r) => r.isInProgress) || null;
});
```

`getResults` **ne pose pas** `projectSlug` sur l’item SSE (`resultcontroller.js` ~36–51). Impossible de filtrer la liste sans l’ajouter.

`stageLive` préfère `localLive` si `localComputeRunning` — qui vient de `progressFor(slug page)`. Après le vol du slug, B croit tourner.

### 4. Ce qui marche déjà (ne pas casser)

- Snapshots params à l’entrée/sortie projet (`files.js`).
- Le wasm continue dans le registre après démontage de la page.
- `progressFor(projectSlug)` est le bon API **si** le slug n’est pas volé.
- SSE résultats **par projet** une fois reconnecté (`/api/project/${slug}/results`).
- 409 `jobs_in_progress` à la suppression.

---

## Décision produit

**Isoler, ne pas verrouiller.**

- Nesting A en cours → clic projet B **autorisé**.
- B : atelier idle (sa tôle, ses fichiers). Pas de live A, pas de spinner A.
- A continue dans le registre. Badge optionnel « calcul en cours » sur A dans la liste.
- Retour sur A : live + timer + bouton calcul **reprennent** (`watch` + `progressFor('A')`).
- Free (1 nest) : B peut être consulté ; lancer un nest sur B → 409 / file existante, pas un reset de A.

**Filet (seulement si un chemin reste non isolable après les tests)** : `hasActiveLocalJob()` vrai → liens projets `pointer-events: none` + toast `nest.stayOnProject` (« Un nesting est en cours sur {name}. Restez sur ce projet ou attendez la fin. »). Ne pas l’implémenter en premier.

---

## Travail — 4 tickets, 1 PR

### A.0 — Filet de référence (Docker local)

Rien à merger. Noter les comptes **avant** les diffs.

```bash
# dans Nestorcut/
npx vitest run
cd workers/nesting && python -m pytest tests/ -q --ignore=tests/test_integration_holes.py
cd workers/common && python -m pytest tests/ -q
cd workers/fileprocessing && python -m pytest tests/ -q
# optionnel si rust toolchain locale :
# cd workers/nesting/engine && cargo test --release -p nest-engine
# cd workers/geometry && cargo test -p nest-export
```

App Docker (override déjà en place) :

```bash
docker compose build app
docker compose up -d
# compte local : AGENTS.md §4 (guillaume@local.dev)
```

Coller les comptes dans ce doc ou un commentaire de PR (AGENTS §5 : vitest 321, pytest nesting 104, etc. — **recompter**, les chiffres ont pu bouger).

Hors A.0 : `determinism_lock.py` / rebuild wasm — **pas** de changement moteur ici.

---

### A.1 — Registre : le projet d’un job est immuable

Fichier : `app/composables/localSolverRegistry.js`

- Si le job existe déjà (`queued` | `running` | `done`) : **ne plus écrire** `projectSlug`.
- `ensureJob` refuse un `projectSlug` différent de celui déjà stocké (log / no-op, pas de relance).
- Nouveau helper `hasActiveJob(projectSlug)` → queued|running.
- Nouveau `activeJobs()` pour un badge liste (slug + phase + projectSlug).

Tests (`app/tests/localSolverRegistry.test.js`), **le cas qui manque** :

```js
it('re-subscribe depuis un autre projet ne vole pas le projectSlug', async () => {
    const mod = await freshRegistry(async () => { await gate; return { ok: true } })
    mod.ensureJob(job('j1'), { projectSlug: 'pA' })
    mod.ensureJob(job('j1'), { projectSlug: 'pB' }) // navigation
    expect(mod.progressFor('pA').phase).toBe('running')
    expect(mod.progressFor('pB')).toBe(null)
})
```

Plus : `progressFor('pB')` pendant un job `pA` = null ; cancel d’un projet ne tue pas l’autre.

---

### A.2 — La page ne s’abonne qu’aux jobs **de ce** projet

Fichiers : `app/pages/project/[slug].vue`, `server/features/results/resultcontroller.js`

1. **Champ additif** `projectSlug` sur chaque item SSE (piège #19b : n’enlever / renommer aucun champ).
2. Watch `awaiting_local` :

   `resultsList.find(r => r.status === 'awaiting_local' && r.projectSlug === route.params.slug)`

   Si `projectSlug` absent (job legacy) : ne **pas** `ensureJob` avec le slug de la page courante ; ignorer (le registre a déjà le job si lancé depuis A).
3. `ensureJob(..., { projectSlug: job.projectSlug || route.params.slug })` — jamais le slug de page si le job en porte un autre.
4. `liveResult` / `runningJob` : même filtre `r.projectSlug === slug` **ou**, à défaut, intersection avec `progressFor(slug)?.slug`.
5. `stageLive` : si `progressFor(slug)` est null, **pas** de `localLive` / `localReveal` d’un autre projet (les refs page se recréent au mount — OK si le watch ne les remplit pas).
6. `btnIsDisable` / spinner : `runningJob` déjà filtré ; **aussi** `hasActiveJob(slug)` pour le cas local où le SSE de B est vide mais on ne doit pas afficher le spinner de A.

Tests serveur : item results porte `projectSlug` (`server/tests/` existant results / localCompute).  
Test page : s’il n’y a pas de harness Vue, extraire `pickLiveJob(list, slug)` dans un util testable (même pattern que `projects.js`).

---

### A.3 — UI navigation : B reste propre, A signale le calcul

Fichiers : `UserProjectItem.vue` / `UserProjects.vue`, `i18n.js`, éventuellement pastille

- Liste projets : si `hasActiveJob(project.slug)` → pastille / texte `project.nestingInProgress` (« calcul en cours »), **cliquable**.
- Page B : `stageHeading` = `live.ready`, tôle idle. Zéro frame A.
- **Pas** de `navigateTo` bloqué, **pas** de overlay plein écran.

Filet lock (ticket séparé, **ne pas merger dans la même PR** sauf si A.1–A.2 laissent un trou e2e) :

- `hasActiveJob` pour un **autre** slug + tentative de `startsNest` sur B : message existant concurrent / 409. Suffit souvent.
- Lock menu : seulement si e2e montre encore un vol de live.

---

### A.4 — Vérification (Docker + navigateur)

Compte `guillaume@local.dev` (AGENTS §4). Deux projets cloud **ou** locaux (THIS DEVICE — c’est là que le bug se voit).

Scénario unique, bloquant :

1. Projet A : lancer un nest (assez long : démo ou 50+ pièces).
2. Pendant le live : ouvrir la liste, cliquer projet B.
3. **Attendu B** : pas de pièces de A, pas de timer, pas de « Calcul… », fichiers/params de B (snapshots §O).
4. Le wasm d’A **continue** (onglet Réseau / CPU ; au retour sur A le live a avancé).
5. Retour A : live + zone + timer cohérents, pas un nouveau job (`ensureJob` idempotent — 1 seul POST nest).
6. Home pendant le nest A : A toujours en cours au retour.
7. F5 sur B pendant nest A : A survit (registre module ; F5 **tue** le wasm — documenter : F5 = nouvel onglet = mort du solve local. Ce n’est pas un bug d’isolation SPA).

Si 3 ou 5 échouent après A.1–A.2 → alors seulement le lock menu.

Vitest : `npx vitest run` (registry + util pickLiveJob + results `projectSlug`).  
Pas de rebuild wasm.

---

## Fichiers touchés (A.1–A.3)

| Fichier | Changement |
|---|---|
| `app/composables/localSolverRegistry.js` | slug immuable, `hasActiveJob` |
| `app/tests/localSolverRegistry.test.js` | cas vol de slug |
| `server/features/results/resultcontroller.js` | `projectSlug` additif |
| `server/tests/` (results / localCompute) | assert champ |
| `app/pages/project/[slug].vue` | filtres live / awaiting_local / running |
| NEW petit util `app/utils/liveJob.js` (si extraction) + test | `pickLiveJob(list, slug)` |
| `app/components/UserProjectItem.vue` | pastille |
| `app/utils/i18n.js` | FR/EN `project.nestingInProgress` |

Hors scope A : `exportParams`, `LENGTH_PARAM_KEYS`, défaut space 2 mm, `nest.post.js` helper, kerf, CLC, lock menu (sauf trou e2e).

---

## Ordre de merge

1. A.0 comptes (commentaire PR, pas un commit).
2. A.1 registre + tests (peut merger seul, déjà un gain).
3. A.2 page + SSE `projectSlug`.
4. A.3 pastille.
5. A.4 e2e Docker. Si fail → A.3bis lock, pas un rollback de l’isolation.

Un seul PR `fix(app): isolation live nesting entre projets` si ça reste petit.

---

## Critère de sortie Phase A

- [ ] Vol de `projectSlug` : test registry rouge avant / vert après.
- [ ] A nest → B : B idle, A continue, retour A = même job.
- [ ] Réglages §O toujours OK (pas de régression snapshots).
- [ ] `npx vitest run` ≥ baseline A.0.
- [ ] Aucun fichier CLC / kerf.
- [ ] Navigation **libre** (lock non shippé, ou justifié par un trou écrit).

Ensuite seulement le chantier B (`PLAN-coupe-commune.md`).
