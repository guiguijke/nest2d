<script setup lang="ts">
// First-time setup page. Shown only when no admin account exists yet.
// Requires the one-time token printed in the server logs.
definePageMeta({ layout: 'auth', middleware: ['admin-auth'] })

const { fetchMe } = useAdminAuth()

const token = ref('')
const email = ref('')
const name = ref('')
const password = ref('')
const passwordConfirm = ref('')
const error = ref('')
const done = ref(false)
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  if (password.value !== passwordConfirm.value) {
    error.value = 'Les mots de passe ne correspondent pas.'
    return
  }
  loading.value = true
  try {
    const res = await $fetch('/api/setup/first-admin', {
      method: 'POST',
      body: {
        token: token.value,
        email: email.value,
        name: name.value,
        password: password.value,
      },
    })
    done.value = true
    // After creating the admin, go to login.
    setTimeout(async () => {
      await fetchMe()
      await navigateTo('/login')
    }, 1800)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || 'Échec de la création.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Brand header -->
    <div class="flex items-center gap-3">
      <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue text-lg font-bold text-white shadow-lg shadow-blue/20">N</div>
      <div>
        <h1 class="text-base font-semibold text-white">NestorCut</h1>
        <p class="text-[11px] text-ink-400">Configuration initiale</p>
      </div>
    </div>

    <!-- Success state -->
    <div v-if="done" class="card space-y-2 text-center">
      <div class="text-2xl">✓</div>
      <p class="text-sm text-white">Compte administrateur créé.</p>
      <p class="text-[11px] text-ink-400">Redirection vers la connexion…</p>
    </div>

    <!-- Setup form -->
    <form v-else class="card space-y-4" @submit.prevent="onSubmit">
      <!-- Token -->
      <div class="space-y-1.5">
        <label class="label" for="token">Jeton de configuration</label>
        <input
          id="token"
          v-model="token"
          class="input font-mono"
          placeholder="affiché dans les logs du conteneur (docker compose logs admin)"
          required
          autofocus
        />
        <p class="text-[10px] text-ink-400">
          Récupérez ce jeton avec : <code class="font-mono">docker compose logs admin | grep -A2 TOKEN</code>
        </p>
      </div>

      <div class="border-t border-marine-700 pt-4">
        <p class="mb-3 text-[11px] uppercase tracking-wide text-ink-400">Compte administrateur</p>
      </div>

      <div class="space-y-1.5">
        <label class="label" for="name">Nom</label>
        <input id="name" v-model="name" class="input" placeholder="Admin" required />
      </div>

      <div class="space-y-1.5">
        <label class="label" for="email">Email</label>
        <input id="email" v-model="email" type="email" autocomplete="username" class="input" placeholder="admin@exemple.fr" required />
      </div>

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="space-y-1.5">
          <label class="label" for="password">Mot de passe</label>
          <input id="password" v-model="password" type="password" autocomplete="new-password" class="input" placeholder="••••••••••" required />
        </div>
        <div class="space-y-1.5">
          <label class="label" for="passwordConfirm">Confirmer</label>
          <input id="passwordConfirm" v-model="passwordConfirm" type="password" autocomplete="new-password" class="input" placeholder="••••••••••" required />
        </div>
      </div>
      <p class="text-[10px] text-ink-400">Minimum 10 caractères.</p>

      <p
        v-if="error"
        class="flex items-center gap-2 rounded-md border border-err/30 bg-err/10 px-3 py-2 text-xs text-err"
      >
        <span>⚠</span>
        <span>{{ error }}</span>
      </p>

      <button type="submit" class="btn-primary w-full py-2" :disabled="loading || !token || !email || !name || !password">
        <span v-if="loading">Création…</span>
        <span v-else>Créer le compte administrateur</span>
      </button>
    </form>

    <p class="text-center text-[11px] text-ink-400">
      Cette page n'est accessible que tant qu'aucun administrateur n'existe.
    </p>
  </div>
</template>
