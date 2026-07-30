<template>
    <label 
        :class="inputClasses"
        class="input"
    >
        <span v-if="prefix" class="input__prefix">
            {{ prefix }}
        </span>
        <component
            :is="tag"
            ref="inputElement"
            :type="type"
            :placeholder="placeholder"
            :value="modelValue"
            @input="handleInput"
            @keydown="$emit('keydown', $event)"
            class="input__value"
        />
        <span v-if="suffix" class="input__suffix">
            {{ suffix }}
        </span>
    </label>
</template>

<script setup>

const inputElement = ref(null)

const { isDisable, isError, tag, modelValue } = defineProps({
    prefix: { 
        type: String, 
        default: "" 
    },
    suffix: { 
        type: String, 
        default: "" 
    },
    modelValue: { 
        type: [String, Number], 
        required: true 
    },
    type: { 
        type: String, 
        default: "text" 
    },
    placeholder: { 
        type: String, 
        default: "" 
    },
    isDisable: {
        type: Boolean,
        default: false
    },
    isError: {
        type: Boolean,
        default: false
    },
    tag: {
        type: String,
        default: "input"
    }
});

const emit = defineEmits(['update:modelValue', 'keydown'])

const handleInput = (event) => {
    emit('update:modelValue', event.target.value)
}

const autoResize = (element) => {
    element.style.height = '14.39px'

    if (element.scrollHeight > 14.39) {
        element.style.height = element.scrollHeight + 'px'
    }
}

watch(() => modelValue, async () => {
    if (tag === 'textarea') {
        await nextTick()
        if (inputElement.value) {
            autoResize(inputElement.value)
        }
    }
})

const inputClasses = computed(() => ({
    'input--disable': isDisable,
    'input--error': isError
}))
</script>
<style lang="scss" scoped>
.input {
    $self: &;
    border-radius: 6px;
    background-color: var(--background-primary);
    padding: 11px 12px;
    display: flex;
    align-items: center;
    font-weight: 500;
    border: 1.5px solid var(--separator-primary);
    transition: border-color 0.2s, box-shadow 0.2s, background-color 0.2s;
    &__prefix,
    &__suffix {
        color: var(--label-tertiary);
        flex-shrink: 0;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }
    &__prefix {
        margin-right: 8px;
    }
    &__suffix {
        margin-left: 8px;
    }
    &__value {
        color: var(--label-primary);
        flex-grow: 1;
        background-color: transparent;
        // Reset the browser's native input border — the container alone draws
        // the textbox frame (no double border / sunken look).
        border: none;
        appearance: none;
        outline: none;
        min-width: 26px;
        resize: none;
        overflow: hidden;
        line-height: 1.4;
        font-size: 15px;
        font-weight: 600;
        width: 100%;

        &:is(textarea) {
            min-height: 14.39px;
            height: 14.39px;
            line-height: 1.2;
        }

        &::placeholder {
            color: var(--label-tertiary);
            font-weight: 500;
        }
    }

    &__value,
    &__suffix,
    &__prefix {
        transition: opacity 0.3s, color 0.2s;
    }

    @media (hover:hover) {
        &:hover {
            border-color: var(--separator-primary);
        }
    }

    &:focus-within {
        background-color: var(--background-primary);
        border-color: var(--accent-primary);
        box-shadow:
            0 0 0 3px color-mix(in srgb, var(--accent-primary) 14%, transparent),
            0 2px 6px color-mix(in srgb, var(--label-primary) 8%, transparent);

        #{$self}__prefix {
            color: var(--accent-primary);
        }
    }

    &--error {
        border-color: var(--error-border);
        background-color: var(--error-background);

        &:focus-within {
            border-color: var(--error-border);
            box-shadow: 0 0 0 3px color-mix(in srgb, var(--error-border) 30%, transparent);
        }
    }

    &--disable {
        pointer-events: none;
        opacity: 0.5;

        #{$self}__value,
        #{$self}__suffix,
        #{$self}__prefix {
            opacity: 0.5;
        }
    }
}
</style>