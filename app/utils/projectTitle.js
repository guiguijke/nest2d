/**
 * Display name derived from an uploaded file. Used as the project title
 * in the UI. For 100 % private projects the result stays in IndexedDB —
 * it must never be PATCHed to the server (filenames do not leave the
 * device on that path).
 */
export function titleFromFileName(name) {
    const base = String(name || '')
        .replace(/^.*[/\\]/, '')
        .replace(/\.[^.]+$/, '')
        .replace(/[\u0000-\u001f<>:"|?*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return base.slice(0, 80)
}
