# =============================================================================
# NestorCut — création des fiches d'abonnement Stripe LIVE (wrapper PowerShell)
#
# Lance scripts/create-live-products.mjs avec la clé secrète demandée de façon
# sécurisée : saisie masquée, hors historique PowerShell, jamais écrite dans
# un fichier, variable d'environnement supprimée à la fin.
#
# Usage (depuis n'importe quel dossier) :
#   powershell -ExecutionPolicy Bypass -File scripts\create-live-products.ps1
#
# Pour un essai en mode test Stripe :
#   powershell -ExecutionPolicy Bypass -File scripts\create-live-products.ps1 -AllowTest
# =============================================================================
[CmdletBinding()]
param(
    [switch]$AllowTest
)

$ErrorActionPreference = 'Stop'

# Saisie masquée : la clé n'apparaît ni à l'écran ni dans l'historique PSReadLine.
$secure = Read-Host -AsSecureString 'Colle ta clé secrète Stripe LIVE (sk_live_...)'
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Error 'Clé vide — abandon.'
    exit 1
}

# Le script Node vit à côté de ce fichier, peu importe le dossier courant.
$nodeScript = Join-Path $PSScriptRoot 'create-live-products.mjs'
if (-not (Test-Path $nodeScript)) {
    Write-Error "Script introuvable : $nodeScript"
    exit 1
}

$env:STRIPE_SECRET_KEY = $key
try {
    $nodeArgs = @($nodeScript)
    if ($AllowTest) { $nodeArgs += '--allow-test' }
    & node @nodeArgs
    exit $LASTEXITCODE
}
finally {
    # La clé ne vit que le temps du process.
    Remove-Item Env:STRIPE_SECRET_KEY -ErrorAction SilentlyContinue
    $key = $null
}
