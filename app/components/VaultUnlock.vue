<template>
    <DialogWrapper v-model:isModalOpen="isOpen" trackingTag="vault_unlock">
        <div class="vault-unlock">
            <MainTitle label="Unlock your vault" class="vault-unlock__title" />
            <p class="vault-unlock__text">
                Your files are encrypted with your personal key file
                (<code>aplasma-vault-…​.key.json</code>). Drop it here to unlock
                this work session.
            </p>

            <label
                class="vault-unlock__drop"
                @dragover.prevent
                @drop.prevent="onDrop"
            >
                <input
                    type="file"
                    accept=".json,application/json"
                    class="vault-unlock__input"
                    @change="onPick"
                />
                {{ keyName || 'Drop your key file here, or click to browse' }}
            </label>

            <label class="vault-unlock__remember">
                <input type="checkbox" v-model="remember" />
                <span>
                    Remember the key in this browser
                    <small>Anyone using this browser will be able to unlock the vault.</small>
                </span>
            </label>

            <p v-if="error" class="vault-unlock__error">{{ error }}</p>

            <MainButton
                :theme="themeType.primary"
                label="Unlock"
                :isDisable="!keyBytes || loading"
                trackingTag="vault_unlock_submit"
                @click="unlock"
                class="vault-unlock__btn"
            />
        </div>
    </DialogWrapper>
</template>

<script setup>
import { themeType } from '~~/constants/theme.constants'
import {
    getRememberedKey,
    keyToBase64,
    parseKeyFile,
    rememberKeyInBrowser,
} from '~/utils/vault'
import { trackEvent } from '~/utils/track'

const isOpen = useVaultUnlockDialog()

const keyBytes = ref(null)
const keyName = ref('')
const remember = ref(false)
const error = ref('')
const loading = ref(false)

async function onFile(file) {
    error.value = ''
    try {
        keyBytes.value = await parseKeyFile(file)
        keyName.value = file.name
    } catch (err) {
        keyBytes.value = null
        keyName.value = ''
        error.value = err.message
    }
}

const onPick = (e) => e.target.files?.[0] && onFile(e.target.files[0])
const onDrop = (e) => e.dataTransfer.files?.[0] && onFile(e.dataTransfer.files[0])

async function unlockWithKey(base64Key, { silent = false } = {}) {
    error.value = ''
    loading.value = true
    try {
        await $fetch('/api/security/vault/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: base64Key }),
        })
        if (remember.value) {
            await rememberKeyInBrowser(base64Key)
        }
        trackEvent('vault_unlocked', { silent })
        isOpen.value = false
        await authStore.actions.setUser()
    } catch (err) {
        const message = err?.data?.statusMessage || ''
        if (message === 'wrong_key') {
            error.value = 'This key does not match your vault. Check you picked the right key file.'
        } else if (message) {
            // Surface the real server message instead of masking every non-
            // wrong_key error as a generic failure (which previously hid
            // e.g. a misconfigured deployment master key behind a vague
            // "try again"). Clean it up slightly for display.
            error.value = message
                .replace(/_/g, ' ')
                .replace(/^\w/, (c) => c.toUpperCase())
        } else {
            error.value = 'Unlock failed. Please try again.'
        }
    } finally {
        loading.value = false
    }
}

async function unlock() {
    if (!keyBytes.value) return
    await unlockWithKey(keyToBase64(keyBytes.value))
}

// Silent unlock when the key was remembered in this browser.
onMounted(async () => {
    const remembered = await getRememberedKey()
    if (remembered) {
        await unlockWithKey(remembered, { silent: true })
    }
})
</script>

<style lang="scss" scoped>
.vault-unlock {
    display: flex;
    flex-direction: column;
    padding: 8px;

    &__title {
        text-align: center;
    }
    &__text {
        margin-top: 12px;
        color: var(--label-secondary);
        font-size: 14px;
        text-align: center;
    }
    &__drop {
        margin-top: 20px;
        padding: 24px 16px;
        border: 2px dashed var(--separator-primary);
        border-radius: 12px;
        text-align: center;
        font-size: 14px;
        color: var(--label-secondary);
        cursor: pointer;
        transition: border-color 0.3s;

        @media (hover:hover) {
            &:hover {
                border-color: var(--accent-primary);
            }
        }
    }
    &__input {
        display: none;
    }
    &__remember {
        margin-top: 16px;
        display: flex;
        align-items: flex-start;
        gap: 8px;
        font-size: 14px;
        color: var(--label-secondary);
        cursor: pointer;

        small {
            display: block;
            color: var(--label-tertiary);
        }
    }
    &__error {
        margin-top: 12px;
        color: var(--error-border, #ef4444);
        font-size: 14px;
        text-align: center;
    }
    &__btn {
        margin-top: 20px;
        width: 100%;
    }
}
</style>
