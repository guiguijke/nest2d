
import { computed, reactive, readonly } from 'vue'
import { processingType } from '~~/constants/files.constants'

const { actions } = globalStore
const { getProjects, setModalNestData } = actions

const state = reactive({
    projectFiles: null,
    projectName: '',
    lastParams: '',
    params: {
        widthPlate: '400',
        heightPlate: '560',
        space: '0.1',
        sheetCount: 100,
        addOutShape: false,
        rotationCount: 4
    },
    isSvgLoaded: computed(
        () =>
            state.projectFiles?.every(
                (file) => file.processingStatus !== processingType.inProgress
            ) || false
    ),
    filesStatusDone: computed(
        () =>
            state.projectFiles?.filter(
                (file) => file.processingStatus === processingType.done
            ) || []
    ),
    filesToNest: computed(() =>
        state.filesStatusDone.map((file) => ({
            slug: file.slug,
            count: file.count,
            // Per-file rotation override wins; otherwise use the global setting.
            rotation: file.rotation || JSON.stringify(buildRotationAngles(Number(state.params.rotationCount)))
        }))
    ),
    currentFilesSlug: computed(
        () => new Set(state.projectFiles?.map((file) => file.slug) || [])
    ),
    isValidParams: computed(() =>
        !isValidNumber(state.params.widthPlate) ||
        !isValidNumber(state.params.heightPlate) ||
        !isValidNumber(state.params.space) ||
        !isValidNumber(state.params.sheetCount)
    ),
    requestBody: computed(() =>
        JSON.stringify({
            files: state.filesToNest,
            params: {
                width: Number(state.params.widthPlate),
                height: Number(state.params.heightPlate),
                tolerance: Number(state.params.tolerance),
                space: Number(state.params.space),
                sheetCount: Number(state.params.sheetCount),
                addOutShape: state.params.addOutShape,
                rotationCount: Number(state.params.rotationCount)
            }
        })
    )
})

let updateTimer

async function getProject(path) {
    try {
        const data = await $fetch(path)
        setProjectFiles(data.files, path)
        setProjectName(data.name)
    } catch (error) {
        if (error?.data?.statusMessage === 'vault_locked') {
            const vaultUnlockDialog = useVaultUnlockDialog();
            vaultUnlockDialog.value = true;
            return
        }
        console.error('Error fetching project:', error)
        navigateTo("/home");
    }
}
function setProjectName(name) {
    state.projectName = name
}
function setProjectFiles(files, path) {
    state.projectFiles = [
        ...files.map((file, fileIndex) => ({
            ...file,
            count: state.currentFilesSlug.has(file.slug)
                ? state.projectFiles[fileIndex].count
                : 1,
            rotation: state.currentFilesSlug.has(file.slug)
                ? state.projectFiles[fileIndex].rotation
                : null
        }))
    ]
    if (updateTimer) {
        clearTimeout(updateTimer)
    }
    if (!state.isSvgLoaded) {
        updateTimer = setTimeout(() => getProject(path), 5000)
    }
}
async function addFiles(files, slug) {
    const formData = new FormData()
    formData.append('projectName', state.projectName)
    files.forEach((file) => formData.append('dxf', file))
    try {
        await $fetch(API_ROUTES.ADDFILES(slug), {
            method: 'POST',
            body: formData
        })

        await getProject(API_ROUTES.PROJECT(slug))
    } catch (error) {
        console.error('Error while uploading files:', error)
    }
}
function isValidNumber(value) {
    return /^\d+([.,]\d+)?$/.test(value)
}
/**
 * Builds the array of allowed rotation angles (in degrees) from a rotation
 * count. N rotations are spread evenly around the full circle, always
 * including 0°. Examples:
 *   1 -> [0]
 *   2 -> [0, 180]
 *   4 -> [0, 90, 180, 270]
 *   8 -> [0, 45, 90, ..., 315]
 * Clamped to [1, 360] to stay sane.
 */
function buildRotationAngles(count) {
    const n = Math.min(360, Math.max(1, Math.floor(Number(count) || 4)))
    if (n === 1) return [0]
    const step = 360 / n
    return Array.from({ length: n }, (_, i) => Math.round(i * step))
}
function updateParams(param) {
    state.params = { ...state.params, ...param }
}
function increment(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count + step <= 999) {
        state.projectFiles[index].count += step
    } else {
        state.projectFiles[index].count = 999
    }
}
function decrement(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    if (state.projectFiles[index].count - step >= 0) {
        state.projectFiles[index].count -= step
    } else {
        state.projectFiles[index].count = 0
    }
}
function updateCount(value, index) {
    if (!isValidNumber(value)) {
        state.projectFiles[index].count = 0
    } else if (Number(value) > 999) {
        state.projectFiles[index].count = 999
    } else {
        state.projectFiles[index].count = Number(value)
    }
}
function updateRotation(value, index) {
    if (state.projectFiles[index]) {
        state.projectFiles[index].rotation = value
    }
}
async function nest(slug) {
    try {
        try {
            const data = await $fetch(API_ROUTES.NEST(slug), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: state.requestBody
            })
            setModalNestData(data)
            useInfoAboutNest().value = true
            // Refresh the cached user so the free-quota banner reflects the
            // operation that was just consumed.
            await authStore.actions.setUser()
        } catch (error) {
            if (error?.response?.status === 402) {
                const buyCreditsDialog = useBuyCreditsDialog();
                buyCreditsDialog.value = true;
                return
            }
            if (error?.data?.statusMessage === 'vault_locked') {
                const vaultUnlockDialog = useVaultUnlockDialog();
                vaultUnlockDialog.value = true;
                return
            }
        }

        await Promise.all([getProjects()])

        state.lastParams = state.requestBody
    } catch (err) {
        console.error('Nest operation failed:', err)
    }
}

export const filesStore = readonly({
    getters: {
        projectFiles: computed(() => state.projectFiles),
        filesCount: computed(() =>
            state.filesStatusDone.reduce((acc, curr) => acc + curr.count, 0)
        ),
        isNewParams: computed(() => state.requestBody !== state.lastParams),
        params: computed(() => state.params),
        nestRequestError: computed(() => {
            if (filesStore.getters.filesCount < 1) {
                return 'Please select at least one file to nest.'
            }
            if (state.isValidParams) {
                return 'Please enter valid values for width, height, tolerance and space.'
            }

            return ''
        })
    },
    actions: {
        setProjectFiles,
        setProjectName,
        updateParams,
        updateCount,
        updateRotation,
        getProject,
        increment,
        decrement,
        addFiles,
        nest
    }
})
