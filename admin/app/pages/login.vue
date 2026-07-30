<script setup lang="ts">
definePageMeta({ layout: 'auth', middleware: ['admin-auth'] })

const { login } = useAdminAuth()
const route = useRoute()

const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function onSubmit() {
  error.value = ''
  loading.value = true
  try {
    await login(email.value, password.value)
    const redirect = (route.query.redirect as string) || '/'
    await navigateTo(redirect)
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.statusMessage || 'Échec de la connexion.'
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
        <p class="text-[11px] text-ink-400">Panneau d'administration</p>
      </div>
    </div>

    <!-- Login card -->
    <form class="card space-y-4" @submit.prevent="onSubmit">
      <div class="space-y-1.5">
        <label class="label" for="email">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          autocomplete="username"
          class="input"
          placeholder="admin@exemple.fr"
          required
          autofocus
        />
      </div>

      <div class="space-y-1.5">
        <label class="label" for="password">Mot de passe</label>
        <input
          id="password"
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="input"
          placeholder="••••••••••"
          required
        />
      </div>

      <p
        v-if="error"
        class="flex items-center gap-2 rounded-md border border-err/30 bg-err/10 px-3 py-2 text-xs text-err"
      >
        <span>⚠</span>
        <span>{{ error }}</span>
      </p>

      <button type="submit" class="btn-primary w-full py-2" :disabled="loading || !email || !password">
        <span v-if="loading">Connexion…</span>
        <span v-else>Se connecter</span>
      </button>
    </form>

    <p class="text-center text-[11px] text-ink-400">
      Accès réservé · réseau local uniquement
    </p>
  </div>
</template>
