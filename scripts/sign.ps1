# Authenticode-signs a binary with the PontuAll self-signed certificate whose
# SHA-256 fingerprint is recorded in src-tauri/signing/cert-fingerprint.txt.
# Used by sidecar/build.ts and by Tauri's bundle.windows.signCommand.
param(
    [Parameter(Mandatory = $true)][string]$Path
)
$ErrorActionPreference = "Stop"

$fingerprintFile = Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\signing\cert-fingerprint.txt"
if (-not (Test-Path $fingerprintFile)) {
    throw "src-tauri\signing\cert-fingerprint.txt not found; run scripts\generate-signing-cert.ps1 first"
}
$fingerprint = (Get-Content $fingerprintFile -Raw).Trim()

# No -CodeSigningCert here: the dynamic provider parameter is unreliable under
# Windows PowerShell 5.1; the fingerprint match is what actually matters.
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    ([System.BitConverter]::ToString($sha256.ComputeHash($_.RawData)) -replace "-", "").ToLowerInvariant() -eq $fingerprint
} | Select-Object -First 1
if (-not $cert) {
    throw "no certificate in Cert:\CurrentUser\My matches fingerprint $fingerprint; run scripts\generate-signing-cert.ps1"
}

$result = Set-AuthenticodeSignature -FilePath $Path -Certificate $cert -HashAlgorithm SHA256
# A self-signed certificate is not chained to a trusted root, so the reported
# status is UnknownError ("not trusted") even though the signature was applied.
if ($result.Status -ne "Valid" -and $result.Status -ne "UnknownError") {
    throw "signing $Path failed: $($result.Status) - $($result.StatusMessage)"
}
Write-Host "signed $Path with $($cert.Thumbprint)"
