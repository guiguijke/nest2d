<template>
    <label 
        :class="selectorClasses"
        class="selector"
    >
        <span v-if="label" class="selector__label">
            {{ label }}
        </span>
        <select
            :value="modelValue"
            @change="handleChange"
            :disabled="isDisable"
            class="selector__value"
        >
            <option 
                v-for="option in options" 
                :key="option.value"
                :value="option.value"
            >
                {{ option.label }}
            </option>
        </select>
        <span class="selector__icon" />
    </label>
</template>

<script setup>
const { isDisable, modelValue, options } = defineProps({
    label: { 
        type: String, 
        default: "" 
    },
    modelValue: { 
        type: [String, Number], 
        required: true 
    },
    options: {
        type: Array,
        required: true,
        validator: (value) => {
            return value.every(option => 
                typeof option === 'object' && 
                'value' in option && 
                'label' in option
            )
        }
    },
    isDisable: {
        type: Boolean,
        default: false
    }
});

const emit = defineEmits(['update:modelValue'])

const handleChange = (event) => {
    emit('update:modelValue', event.target.value)
}

const selectorClasses = computed(() => ({
    'selector--disable': isDisable
}))
</script>

<style lang="scss" scoped>
.selector {
    $self: &;
    border-radius: 8px;
    background-color: var(--background-primary);
    padding: 10px 12px;
    display: flex;
    align-items: center;
    font-weight: 500;
    border: 1px solid var(--separator-primary);
    transition: border-color 0.2s, box-shadow 0.2s;
    position: relative;
    cursor: pointer;

    &__label {
        color: var(--label-secondary);
        flex-shrink: 0;
        margin-right: 8px;
        font-size: 13px;
    }

    &__value {
        color: var(--label-primary);
        flex-grow: 1;
        background-color: transparent;
        outline: none;
        border: none;
        cursor: pointer;
        appearance: none;
        padding-right: 24px;
        font-weight: 600;
        font-size: 15px;

        option {
            background-color: var(--background-primary);
            color: var(--label-primary);
        }
    }

    &__icon {
        position: absolute;
        right: 12px;
        width: 14px;
        height: 14px;
        background-color: var(--label-secondary);
        mask-image: url('/icons/svg/arrow.svg');
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        transform: rotate(90deg);
        pointer-events: none;
        transition: transform 0.3s, opacity 0.3s;
    }

    &__value,
    &__label,
    &__icon {
        transition: opacity 0.3s;
    }

    @media (hover:hover) {
        &:hover {
            border-color: var(--label-tertiary);
        }
    }

    &:focus-within {
        border-color: var(--accent-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-primary) 15%, transparent);

        #{$self}__icon {
            transform: rotate(90deg) scale(1.1);
        }
    }

    &--disable {
        pointer-events: none;
        opacity: 0.5;

        #{$self}__value,
        #{$self}__label,
        #{$self}__icon {
            opacity: 0.5;
        }
    }
}
</style>
