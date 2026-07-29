<template>
  <div class="flex min-h-screen items-center justify-center bg-ink-950 px-4">
    <div class="w-full max-w-sm">
      <div class="mb-8 text-center">
        <div class="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-rust text-xl font-bold text-white">A</div>
        <h1 class="text-lg font-semibold text-white">APlasma — Administration</h1>
        <p class="mt-1 text-xs text-ink-400">Espace réservé · réseau local</p>
      </div>
      <slot />
    </div>
  </div>
</template>
