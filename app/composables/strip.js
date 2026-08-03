import { computed, reactive, readonly } from 'vue'
import { processingType } from '~~/constants/files.constants'
import { convertInputValue, displayToMm } from '~/utils/units'
import { getUnitState } from '~/composables/useUnit'

const state = reactive({
    projectsList: null,
    projectFiles: null,
    projectSlug: null,
    projectName: '',
    fileModalData: {},
    resultModalData: {},
    resultsList: [],
    params: {
        height: '250'
    },
    lastParams: '',
    isNesting: false,
    filesToNest: computed(() =>
        (state.projectFiles || [])
            .filter(
                (file) =>
                    file.count > 0 &&
                    file.processingStatus === processingType.done
            )
            .map((file) => ({
                slug: file.slug,
                count: file.count,
                // Strip nesting only allows keeping the part as-is ([0]) or
                // flipping it 180° ([0, 180]).
                rotation: file.rotation || '[0]'
            }))
    ),
    // params.height holds the DISPLAY-unit string — convert to canonical mm
    // at the API boundary.
    requestBody: computed(() =>
        JSON.stringify({
            files: state.filesToNest,
            params: {
                height: displayToMm(Number(state.params.height), getUnitState())
            }
        })
    ),
})

function isValidNumber(value) {
    return /^\d+([.,]\d+)?$/.test(String(value))
}

let updateTimer

// Keep polling the project while any uploaded file is still being processed by
// the strip file processing worker, so the UI flips from a loader to the
// selectable file as soon as processing completes.
function scheduleFilesRefresh() {
    if (updateTimer) {
        clearTimeout(updateTimer)
        updateTimer = null
    }
    const hasProcessing = (state.projectFiles || []).some(
        (file) => file.processingStatus === processingType.inProgress
    )
    if (hasProcessing && state.projectSlug) {
        updateTimer = setTimeout(
            () => getStripProject(API_ROUTES.STRIP_PROJECT(state.projectSlug)),
            5000
        )
    }
}

async function getStripProjects() {
    try {
        const data = await $fetch(API_ROUTES.STRIP_PROJECTS)
        setStripProjects(data.projects)
    } catch (error) {
        console.error('Error fetching strip projects:', error)
    }
}
function setStripProjects(projects) {
    state.projectsList = [...projects]
}
function setProjectName(name) {
    state.projectName = name
}
function setProjectFiles(files, slug) {
    // Only carry over the user-selected counts when we are reloading the same
    // project (e.g. after uploading more files). When switching to a different
    // project we must start fresh so stale counts/files don't leak across.
    const sameProject = slug != null && slug === state.projectSlug
    const countBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.count])
            : []
    )
    const rotationBySlug = new Map(
        sameProject
            ? (state.projectFiles || []).map((file) => [file.slug, file.rotation])
            : []
    )
    state.projectFiles = files.map((file) => ({
        ...file,
        count: countBySlug.has(file.slug) ? countBySlug.get(file.slug) : 1,
        rotation: rotationBySlug.get(file.slug) || '[0]'
    }))
    state.projectSlug = slug ?? null
    if (!sameProject) {
        // Reset the "already nested" marker so the Nest button reflects the
        // newly loaded project rather than the previous one.
        state.lastParams = ''
    }
    scheduleFilesRefresh()
}
function increment(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    state.projectFiles[index].count = Math.min(
        state.projectFiles[index].count + step,
        999
    )
}
function decrement(index, event) {
    const step = event && event.shiftKey ? 10 : 1
    state.projectFiles[index].count = Math.max(
        state.projectFiles[index].count - step,
        0
    )
}
function updateCount(value, index) {
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0) {
        state.projectFiles[index].count = 0
    } else {
        state.projectFiles[index].count = Math.min(Math.floor(number), 999)
    }
}
function updateRotation(value, index) {
    if (state.projectFiles[index]) {
        state.projectFiles[index].rotation = value
    }
}
async function getStripProject(path) {
    try {
        const data = await $fetch(path)
        setProjectFiles(data.files, data.slug)
        setProjectName(data.name)
    } catch (error) {
        if (error?.data?.statusMessage === 'vault_locked') {
            const vaultUnlockDialog = useVaultUnlockDialog();
            vaultUnlockDialog.value = true;
            return
        }
        console.error('Error fetching strip project:', error)
        navigateTo('/strip')
    }
}
async function addFiles(files, slug) {
    const formData = new FormData()
    files.forEach((file) => formData.append('dxf', file))
    try {
        await $fetch(API_ROUTES.STRIP_ADDFILES(slug), {
            method: 'POST',
            body: formData
        })

        await getStripProject(API_ROUTES.STRIP_PROJECT(slug))
    } catch (error) {
        console.error('Error while uploading strip files:', error)
    }
}
function setModalFileData(file) {
    state.fileModalData = { ...file }
}
function setStripResults(results) {
    state.resultsList = [...results]
}
function setModalResultData(result) {
    state.resultModalData = { ...result }
}
async function getStripResults(slug) {
    try {
        const data = await $fetch(API_ROUTES.STRIP_RESULTS(slug))
        setStripResults(data.items)
    } catch (error) {
        console.error('Error fetching strip results:', error)
    }
}
function updateParams(param) {
    state.params = { ...state.params, ...param }
}

// Factory default strip height per unit (250 mm ~= 10 in).
const FACTORY_HEIGHT = { mm: '250', inch: '10' }

/**
 * Converts the in-progress height between units (called on unit switch).
 * A pristine factory value snaps to the other unit's factory default.
 */
function convertParamsUnits(fromUnit, toUnit) {
    if (!fromUnit || !toUnit || fromUnit === toUnit) return
    const h = String(state.params.height)
    state.params = {
        ...state.params,
        height: h === FACTORY_HEIGHT[fromUnit]
            ? FACTORY_HEIGHT[toUnit]
            : convertInputValue(h, fromUnit, toUnit),
    }
}
async function nest(slug) {
    state.isNesting = true
    try {
        const data = await $fetch(API_ROUTES.STRIP_NEST(slug), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: state.requestBody
        })

        state.lastParams = state.requestBody

        await getStripResults(slug)

        // Refresh the cached user so the free-quota banner reflects the
        // operation that was just consumed.
        await authStore.actions.setUser()

        return data
    } catch (error) {
        // Paywall: free quota exhausted and no active subscription.
        if (error?.response?.status === 402) {
            // Skip the paywall dialog when paid plans are temporarily
            // disabled — it would only offer a "Coming soon" CTA.
            const paidDisabled = useRuntimeConfig().public.paidPlansDisabled === true
            if (!paidDisabled) {
                const buyCreditsDialog = useBuyCreditsDialog();
                buyCreditsDialog.value = true;
            }
            return
        }
        if (error?.data?.statusMessage === 'vault_locked') {
            const vaultUnlockDialog = useVaultUnlockDialog();
            vaultUnlockDialog.value = true;
            return
        }
        throw error
    } finally {
        state.isNesting = false
    }
}

export const stripStore = readonly({
    getters: {
        projectsList: computed(() => state.projectsList),
        projectFiles: computed(() => state.projectFiles),
        projectSlug: computed(() => state.projectSlug),
        projectName: computed(() => state.projectName),
        fileModalData: computed(() => state.fileModalData),
        resultModalData: computed(() => state.resultModalData),
        resultsList: computed(() => state.resultsList),
        filesCount: computed(() =>
            (state.projectFiles || [])
                .filter((file) => file.processingStatus === processingType.done)
                .reduce((acc, file) => acc + (file.count || 0), 0)
        ),
        params: computed(() => state.params),
        requiredHeight: computed(() => {
            const heights = (state.projectFiles || [])
                .filter(
                    (file) =>
                        (file.count || 0) > 0 &&
                        file.processingStatus === processingType.done
                )
                .map((file) => file.minHeight)
                .filter((height) => typeof height === 'number')
            if (heights.length === 0) {
                return null
            }
            // Require at least a 5% margin above the tallest part so it always
            // fits comfortably within the strip.
            return Math.max(...heights) * 1.05
        }),
        isHeightTooSmall: computed(() => {
            const required = stripStore.getters.requiredHeight
            if (required == null) {
                return false
            }
            // minHeight comes from the server in canonical mm — compare in mm.
            const heightMm = displayToMm(Number(state.params.height), getUnitState())
            if (!Number.isFinite(heightMm) || heightMm <= 0) {
                return false
            }
            return heightMm < required
        }),
        isNewParams: computed(() => state.requestBody !== state.lastParams),
        isNesting: computed(() => state.isNesting),
        nestRequestError: computed(() => {
            if (stripStore.getters.filesCount < 1) {
                return 'Please select at least one file to nest.'
            }
            if (!isValidNumber(state.params.height) || Number(state.params.height) <= 0) {
                return 'Please enter a valid height.'
            }
            return ''
        }),
    },
    actions: {
        getStripProjects,
        setStripProjects,
        setProjectName,
        setProjectFiles,
        getStripProject,
        addFiles,
        setModalFileData,
        setModalResultData,
        setStripResults,
        getStripResults,
        increment,
        decrement,
        updateCount,
        updateRotation,
        updateParams,
        convertParamsUnits,
        nest,
    }
})
