<script setup lang="ts">
definePageMeta({ middleware: ['admin-auth'] })

const { data: conversations, refresh: refreshConvos } = await useFetch('/api/support/conversations', { credentials: 'include' })

const selectedUserId = ref<string | null>(null)
const replyText = ref('')
const sending = ref(false)

// Poll conversations list every 15s for fresh threads.
let convoPoll: any
onMounted(() => (convoPoll = setInterval(refreshConvos, 15_000)))
onBeforeUnmount(() => clearInterval(convoPoll))

const threadQuery = computed(() => null)
const { data: thread, refresh: refreshThread } = await useFetch(
  () => `/api/support/${encodeURIComponent(selectedUserId.value || '')}`,
  { request: threadQuery, credentials: 'include', watch: [selectedUserId] },
)

// Auto-scroll to bottom on new messages.
const messagesEl = ref<HTMLElement | null>(null)
watch(() => thread.value?.messages?.length, async () => {
  await nextTick()
  if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight
})

let threadPoll: any
watch(selectedUserId, (id) => {
  clearInterval(threadPoll)
  if (id) {
    threadPoll = setInterval(() => refreshThread(), 15_000)
  }
})
onBeforeUnmount(() => clearInterval(threadPoll))

async function send() {
  if (!selectedUserId.value || !replyText.value.trim()) return
  sending.value = true
  try {
    await $fetch(`/api/support/${encodeURIComponent(selectedUserId.value)}`, {
      method: 'POST',
      body: { message: replyText.value.trim() },
      credentials: 'include',
    })
    replyText.value = ''
    await refreshThread()
    await refreshConvos()
  } finally {
    sending.value = false
  }
}

function fmt(d: any) {
  return d ? new Date(d).toLocaleString('fr-FR') : '—'
}
function senderCls(s: string) {
  if (s === 'support') return 'self-end bg-rust/20 text-ink-100'
  if (s === 'welcome') return 'bg-ink-700 text-ink-300'
  return 'bg-ink-800 text-ink-100'
}
</script>

<template>
  <div class="space-y-4">
    <div>
      <h1 class="text-xl">Support</h1>
      <p class="text-xs text-ink-400">Conversations avec les utilisateurs (rafraîchies toutes les 15 s)</p>
    </div>

    <div class="grid gap-4 lg:grid-cols-[280px_1fr]">
      <!-- Conversation list -->
      <div class="card max-h-[70vh] overflow-y-auto p-0">
        <div v-if="!conversations?.items?.length" class="p-4 text-xs text-ink-400">Aucune conversation.</div>
        <button
          v-for="c in conversations?.items"
          :key="c.userId"
          class="block w-full border-b border-ink-800 px-3 py-2 text-left transition-colors last:border-0 hover:bg-ink-850"
          :class="selectedUserId === c.userId ? 'bg-ink-850' : ''"
          @click="selectedUserId = c.userId"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-white">{{ c.userName || c.userId.slice(0, 20) }}</span>
            <span v-if="c.lastSender === 'user'" class="badge bg-rust/15 text-rust">nouveau</span>
          </div>
          <p class="mt-0.5 truncate text-[11px] text-ink-400">{{ c.lastMessage }}</p>
          <p class="mt-0.5 text-[10px] text-ink-400">{{ fmt(c.timestamp) }}</p>
        </button>
      </div>

      <!-- Thread -->
      <div class="card flex min-h-[70vh] flex-col">
        <div v-if="!selectedUserId" class="m-auto text-xs text-ink-400">Sélectionnez une conversation.</div>
        <template v-else>
          <div class="flex items-center justify-between border-b border-ink-800 pb-2">
            <div>
              <NuxtLink
                v-if="thread?.user"
                :to="`/users/${encodeURIComponent(thread.user.id)}`"
                class="text-sm font-semibold text-white hover:text-rust hover:underline"
              >
                {{ thread.user.name || '—' }}
              </NuxtLink>
              <span v-else class="text-sm font-semibold text-white">Utilisateur</span>
              <p v-if="thread?.user" class="text-[11px] text-ink-400">{{ thread.user.email }}</p>
            </div>
            <span class="text-[11px] text-ink-400">{{ fmt(thread?.user?.createdAt) }}</span>
          </div>

          <div ref="messagesEl" class="flex-1 space-y-2 overflow-y-auto py-3">
            <div
              v-for="(m, i) in thread?.messages"
              :key="i"
              class="max-w-[80%] rounded-md px-3 py-2 text-xs"
              :class="senderCls(m.sender)"
            >
              <p class="whitespace-pre-wrap break-words">{{ m.message }}</p>
              <p class="mt-1 text-[10px] opacity-60">{{ m.sender }} · {{ fmt(m.timestamp) }}</p>
            </div>
          </div>

          <form class="flex items-end gap-2 border-t border-ink-800 pt-3" @submit.prevent="send">
            <textarea
              v-model="replyText"
              rows="2"
              class="input flex-1 resize-none"
              placeholder="Votre réponse…"
            />
            <button class="btn-primary" :disabled="sending || !replyText.trim()">{{ sending ? '…' : 'Envoyer' }}</button>
          </form>
        </template>
      </div>
    </div>
  </div>
</template>
