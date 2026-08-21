/**
 * Régime privacy d'un projet — les 3 états visibles (P0/P1).
 *  - demo   : projet démo partagé
 *  - device : pièces dans ce navigateur
 *  - vault  : cloud chiffré (coffre actif au compte)
 *  - cloud  : cloud en clair, purge 24 h
 *
 * Le vault est au compte, pas au projet : un projet `local` reste `device`
 * même si le coffre est allumé (il ne s'applique pas).
 */
export function projectPrivacyMode(project, vaultEnabled = false) {
    if (!project || project.isDemo) return 'demo'
    if (project.local) return 'device'
    return vaultEnabled ? 'vault' : 'cloud'
}

export const PRIVACY_CHIP_KEY = {
    demo: 'demo.badge',
    device: 'privacy.chip.device',
    cloud: 'privacy.chip.cloud',
    vault: 'privacy.chip.vault',
}

export const PRIVACY_STATUS_KEY = {
    device: 'privacy.status.device',
    cloud: 'privacy.status.cloud',
    vault: 'privacy.status.vault',
}
