import { networkInterfaces } from "node:os";

import type { SmtpConfig } from "./mail";

// SMTP credentials live in the Tauri keyring, not here. The parent process
// pushes them along with each internal request that triggers e-mail, and the
// last copy is kept so Better Auth callbacks (sendResetPassword) that fire
// outside an internal request payload can still send.
export const runtime: {
    smtp: SmtpConfig | null;
    publicOrigin: string | null;
    trustedOrigins: string[];
} = {
    smtp: null,
    publicOrigin: null,
    trustedOrigins: [],
};

/**
 * Base URL for e-mailed links, when the operator serves the sidecar behind a
 * stable address (domain, reverse proxy, VPN hostname). Falls back to the
 * auto-detected LAN IP when unset.
 */
export function configuredPublicOrigin(): string | null {
    const raw = process.env.PONTUALL_PUBLIC_URL?.trim();
    if (!raw) return null;
    return raw.replace(/\/+$/, "");
}

/** Extra origins (proxied domains) trusted by Better Auth, from the env the
 * Rust parent sets at spawn. Comma-separated, trailing slashes stripped. */
export function configuredTrustedOrigins(): string[] {
    const raw = process.env.PONTUALL_TRUSTED_ORIGINS?.trim();
    if (!raw) return [];
    return raw
        .split(",")
        .map((o) => o.trim().replace(/\/+$/, ""))
        .filter((o) => o.length > 0);
}

/** Every non-internal IPv4 origin this machine answers on. */
export function publicOrigins(port: number): string[] {
    const origins: string[] = [];
    for (const nets of Object.values(networkInterfaces())) {
        for (const net of nets ?? []) {
            if (net.family === "IPv4" && !net.internal) {
                origins.push(`http://${net.address}:${port}`);
            }
        }
    }
    return origins;
}
