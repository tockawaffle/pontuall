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
