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
  <form class="card space-y-4" @submit.prevent="onSubmit">
    <div>
      <label class="label" for="email">Email</label>
      <input id="email" v-model="email" type="email" autocomplete="username" class="input" required autofocus />
    </div>
    <div>
      <label class="label" for="password">Mot de passe</label>
      <input id="password" v-model="password" type="password" autocomplete="current-password" class="input" required />
    </div>

    <p v-if="error" class="rounded-md bg-err/15 px-3 py-2 text-xs text-err">{{ error }}</p>

    <button type="submit" class="btn-primary w-full" :disabled="loading">
      {{ loading ? 'Connexion…' : 'Se connecter' }}
    </button>
  </form>
</template>
