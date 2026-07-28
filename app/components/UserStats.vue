<template>
    <div class="stats">
        <MainTitle label="Your activity" class="stats__title" />
        <div class="stats__grid grid">
            <div class="grid__item item">
                <span class="item__value">{{ stats.projects }}</span>
                <span class="item__label">Projects</span>
            </div>
            <div class="grid__item item">
                <span class="item__value">{{ stats.nestings }}</span>
                <span class="item__label">Nestings run</span>
            </div>
            <div class="grid__item item">
                <span class="item__value">{{ stats.partsNested }}</span>
                <span class="item__label">Parts nested</span>
            </div>
            <div class="grid__item item">
                <span class="item__value">{{ stats.dxfFiles }}</span>
                <span class="item__label">DXF files</span>
            </div>
            <div class="grid__item item">
                <span class="item__value">{{ stats.nestingsThisMonth }}</span>
                <span class="item__label">This month</span>
            </div>
            <div class="grid__item item">
                <span class="item__value">{{ successRate }}%</span>
                <span class="item__label">Success rate</span>
            </div>
        </div>
    </div>
</template>

<script setup>
const stats = ref({
    projects: 0,
    nestings: 0,
    nestingsCompleted: 0,
    nestingsFailed: 0,
    partsNested: 0,
    nestingsThisMonth: 0,
    dxfFiles: 0,
    dxfProcessed: 0,
})

const $apiFetch = useApiFetch()

onMounted(async () => {
    try {
        const data = await $apiFetch('/api/user/stats')
        stats.value = data
    } catch (err) {
        console.error('Failed to load user stats:', err)
    }
})

const successRate = computed(() => {
    const { nestingsCompleted, nestings } = stats.value
    if (!nestings) return 0
    return Math.round((nestingsCompleted / nestings) * 100)
})
</script>

<style lang="scss" scoped>
.stats {
    width: 100%;
    max-width: 520px;

    &__title {
        text-align: center;
        margin-bottom: 16px;
    }
}

.grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;

    @media (min-width: 567px) {
        grid-template-columns: repeat(3, minmax(0, 1fr));
    }
}

.item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 18px 12px;
    border: 1px solid var(--separator-secondary);
    border-radius: 12px;
    background-color: var(--fill-tertiary);
    text-align: center;

    &__value {
        font-size: 1.75rem;
        font-weight: 800;
        color: var(--accent-primary);
        line-height: 1.1;
    }

    &__label {
        font-size: 13px;
        color: var(--label-secondary);
    }
}
</style>
