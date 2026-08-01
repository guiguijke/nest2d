import { ref, computed, watch, onBeforeUnmount } from 'vue'

const defaultTitle = 'NestorCut — State-of-the-art nesting for laser, plasma & CNC cutting'

export default defineNuxtPlugin((nuxtApp) => {
    let interval = null
    const isTabActive = ref(true)
    const nestTitle = ref('Nest ready')

    // Blink the document title between default and "Nest ready" so a user on
    // another tab notices a finished nesting. Only runs while a notification
    // is pending and the tab is hidden — and is stopped as soon as the user
    // comes back, instead of running forever.
    const stopTitleCycle = () => {
        if (interval) {
            clearInterval(interval)
            interval = null
        }
        nestTitle.value = 'Nest ready'
    }
    const startTitleCycle = () => {
        stopTitleCycle()
        interval = setInterval(() => {
            nestTitle.value = nestTitle.value !== 'Nest ready' ? 'Nest ready' : defaultTitle
        }, 500)
    }

    const onVisibilityChange = () => {
        isTabActive.value = document.visibilityState === 'visible'
        if (isTabActive.value) {
            // Returning to the tab clears the notification and stops blinking.
            if (globalStore.getters.needNotification) {
                globalStore.actions.updateNotification(false)
            }
            stopTitleCycle()
        }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    // Drive the blinker from the notification state so it only runs while
    // needed (tab hidden + a pending notification).
    watch(
        () => Boolean(globalStore.getters.needNotification) && !isTabActive.value,
        (shouldBlink) => {
            if (shouldBlink) startTitleCycle()
            else stopTitleCycle()
        }
    )

    const title = computed(() => globalStore.getters.needNotification && !isTabActive.value ? nestTitle.value : defaultTitle)

    useHead({
        title: title
    })

    // Plugin is app-scoped but clean up the listener anyway for correctness.
    nuxtApp.hook('app:suspense:resolve', () => {})
    onBeforeUnmount(() => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
        stopTitleCycle()
    })

    nuxtApp.provide('isTabActive', isTabActive)
})