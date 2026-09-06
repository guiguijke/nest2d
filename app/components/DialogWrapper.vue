<template>
    <teleport to="body">
        <div v-if="isModalOpen" class="modal">
            <div class="modal__background" @click="closeModal"></div>
            <!-- 3.1.4 (lot 3, M1) : dialogue accessible — role/aria-modal,
                 focus initial dans la boîte, piège de focus Tab/Shift+Tab,
                 restitution au déclencheur à la fermeture. -->
            <div
                ref="bodyEl"
                class="modal__body modal-body"
                role="dialog"
                aria-modal="true"
                aria-label="Dialog"
                @keydown.tab="trapTab"
            >
                <MainButton label="close modal" :isLabelShow=false :size="sizeType.s" :icon="iconType.close" trackingTag="modal_close" @click="closeModal" class="modal-body__close" />
                <slot />
            </div>
        </div>
    </teleport>
</template>

<script setup>
import { iconType } from '~~/constants/icon.constants';
import { sizeType } from '~~/constants/size.constants';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { trackEvent } from '~/utils/track';

const { isModalOpen, trackingTag } = defineProps({
    isModalOpen: {
        type: Boolean,
        default: false,
    },
    trackingTag: {
        type: String,
        default: '',
    },
})

const emit = defineEmits(["update:isModalOpen"]);

const bodyEl = ref(null)
// 3.1.4 : élément qui avait le focus quand le dialogue s'est ouvert — il
// y est RESTITUÉ à la fermeture (clavier et lecteurs d'écran).
let previouslyFocused = null

const closeModal = () => {
    emit("update:isModalOpen", false);
}

// 3.1.4 : piège de focus — Tab/Shift+Tab restent dans le dialogue.
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const trapTab = (event) => {
    const root = bodyEl.value
    if (!root) return
    const nodes = [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
    if (!nodes.length) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault()
        last.focus()
    } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
    }
}

watch(() => isModalOpen, async (isOpen) => {
    if (isOpen) {
        if (Boolean(trackingTag)) {
            trackEvent(`dialog_view_${trackingTag}`);
        }
        previouslyFocused = document.activeElement
        // Focus initial : premier focusable du dialogue (le bouton fermer
        // en pratique) — annoncé comme dialogue par aria-modal.
        await nextTick()
        const root = bodyEl.value
        const first = root?.querySelector(FOCUSABLE)
        ;(first || root)?.focus?.()
    } else if (previouslyFocused?.focus) {
        previouslyFocused.focus()
        previouslyFocused = null
    }
});

const handleKeydown = (event) => {
    if (event.key === 'Escape' && isModalOpen) {
        event.preventDefault()
        closeModal();
    }
}

onMounted(() => {
    document.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
    document.removeEventListener('keydown', handleKeydown);
});
</script>

<style lang="scss" scoped>
.modal {
    // 3.1.4 : la police mono héritée produisait des dialogues « code » —
    // la typo vient désormais du contenu (résultat, auth…).
    font-size: 14px;
    line-height: 1.4;
    display: flex;
    align-items: center;
    justify-content: center;
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 5;

    &__background {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        background-color: var(--label-tertiary);
    }

    &__body {
        position: relative;
        z-index: 1;
        background-color: var(--background-primary);
        border-radius: 16px;
        max-height: 94vh;
        max-width: 94vw;
    }
}

.modal-body {
    overflow: auto;

    &__close {
        position: absolute;
        top: 8.5px;
        right: 8.5px;
    }
}
</style>
