// Compiles the sidecar into a self-contained executable named with the
// Rust target triple, as Tauri's externalBin bundling requires.
import { $ } from "bun";
import { existsSync, mkdirSync } from "node:fs";

const triple = "x86_64-pc-windows-msvc";
const outDir = "../src-tauri/binaries";
const outfile = `${outDir}/pontuall-auth-${triple}.exe`;

if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
}

await $`bunx --bun prisma generate`;
await $`bun build --compile --minify --target=bun-windows-x64 src/index.ts --outfile ${outfile}`;

console.log(`sidecar built: ${outfile}`);

// Authenticode-sign the sidecar so the app's pinned-certificate check passes.
if (existsSync("../src-tauri/signing/cert-fingerprint.txt")) {
    // pwsh, not powershell: Windows PowerShell 5.1 fails to load the Cert:
    // provider when spawned with PowerShell 7's PSModulePath in the env.
    await $`pwsh -NoProfile -ExecutionPolicy Bypass -File ../scripts/sign.ps1 ${outfile}`;
} else {
    console.warn(
        "signing cert not configured; sidecar left UNSIGNED (run scripts/generate-signing-cert.ps1)",
    );
}
