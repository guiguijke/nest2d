export const useResultDialog = () => {
    return useState("resultDialog", () => false);
};
// Set by the "Nesting report" button on a result card: the result modal
// scrolls straight to the quoting report when it opens.
export const useResultScrollToReport = () => {
    return useState("resultScrollToReport", () => false);
};
export const useFileDialog = () => {
    return useState("fileDialog", () => false);
};
export const useStripFileDialog = () => {
    return useState("stripFileDialog", () => false);
};
export const useStripResultDialog = () => {
    return useState("stripResultDialog", () => false);
};
export const useFullScreen = () => {
    return useState("isFullScreen", () => false);
}
export const useSupportDialog = () => {
    return useState("supportDialog", () => false);
};
export const useBuyCreditsDialog = () => {
    return useState("buyCreditsDialog", () => false);
};
export const useLoginDialog = () => {
    return useState("loginDialog", () => false);
};
export const useVaultUnlockDialog = () => {
    return useState("vaultUnlockDialog", () => false);
};
export const useVaultMenuOpen = () => {
    return useState("vaultMenuOpen", () => false);
};