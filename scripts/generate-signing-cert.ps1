# Creates (or reuses) a self-signed code-signing certificate for PontuAll in
# the current user's certificate store and records its SHA-256 fingerprint in
# src-tauri/signing/cert-fingerprint.txt. The Rust build embeds that
# fingerprint so the app only spawns a sidecar signed by this certificate.
$ErrorActionPreference = "Stop"

$subject = "CN=PontuAll Code Signing"
$signingDir = Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\signing"

$cert = Get-ChildItem Cert:\CurrentUser\My |
    Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date) } |
    Select-Object -First 1

if ($cert) {
    Write-Host "Reusing existing certificate $($cert.Thumbprint)"
} else {
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -CertStoreLocation Cert:\CurrentUser\My `
        -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
        -NotAfter (Get-Date).AddYears(10)
    Write-Host "Created certificate $($cert.Thumbprint)"
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$fingerprint = ([System.BitConverter]::ToString($sha256.ComputeHash($cert.RawData)) -replace "-", "").ToLowerInvariant()

New-Item -ItemType Directory -Force $signingDir | Out-Null
Set-Content -Path (Join-Path $signingDir "cert-fingerprint.txt") -Value $fingerprint -NoNewline
Write-Host "Fingerprint written to src-tauri\signing\cert-fingerprint.txt:"
Write-Host "  $fingerprint"
