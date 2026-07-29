// Opens the SSE live stream and exposes a reactive snapshot of live KPIs.
// Reconnects automatically if the stream drops.
export function useLiveStats() {
  const snapshot = ref<any>(null)
  const connected = ref(false)
  let es: EventSource | null = null
  let reconnectTimer: any = null

  function open() {
    if (import.meta.server) return
    es?.close()
    es = new EventSource('/api/stats/live')
    es.onopen = () => (connected.value = true)
    es.onmessage = (e) => {
      try {
        snapshot.value = JSON.parse(e.data)
      } catch {
        /* ignore malformed frame */
      }
    }
    es.onerror = () => {
      connected.value = false
      es?.close()
      es = null
      // Backoff reconnect.
      reconnectTimer = setTimeout(open, 5000)
    }
  }

  function close() {
    clearTimeout(reconnectTimer)
    es?.close()
    es = null
  }

  onMounted(open)
  onBeforeUnmount(close)

  return { snapshot, connected }
}
