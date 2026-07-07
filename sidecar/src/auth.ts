import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin, bearer } from "better-auth/plugins";
import { prisma } from "./db";
import { sendPasswordSetupEmail } from "./mail";
import { pontuallAc, pontuallRoles } from "./permissions";
import { publicOrigins, runtime } from "./runtime";

export const PASSWORD_LINK_TTL_HOURS = 24;

const port = Number(process.env.PORT ?? 3435);

// All configuration comes from the Tauri (Rust) parent process, which owns
// the keyring-stored secrets and the PostgreSQL URI.
export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "postgresql",
    }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: `http://127.0.0.1:${port}`,
    // The reset-password page is opened from other devices on the network,
    // so every LAN origin of this machine — plus the admin-configured public
    // URL, which can change at runtime — must pass the CSRF origin check.
    trustedOrigins: () => [
        "http://tauri.localhost",
        "tauri://localhost",
        "http://localhost:3000",
        `http://127.0.0.1:${port}`,
        ...publicOrigins(port),
        ...(runtime.publicOrigin ? [runtime.publicOrigin] : []),
    ],
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 10,
        // Passwords are never typed by an admin: accounts are created with a
        // discarded random password and the employee sets their own through
        // this one-time link.
        resetPasswordTokenExpiresIn: 60 * 60 * PASSWORD_LINK_TTL_HOURS,
        revokeSessionsOnPasswordReset: true,
        sendResetPassword: async ({ user, token }) => {
            const smtp = runtime.smtp;
            const origin = runtime.publicOrigin;
            if (!smtp || !origin) {
                throw new Error(
                    "servidor de e-mail não configurado para envio do link de senha",
                );
            }
            await sendPasswordSetupEmail(
                smtp,
                user.email,
                user.name,
                `${origin}/reset-password?token=${token}`,
                PASSWORD_LINK_TTL_HOURS,
                `${origin}/portal`,
            );
        },
    },
    // Enabled unconditionally: the compiled sidecar has no NODE_ENV, so Better
    // Auth's production-only default would otherwise leave sign-in unthrottled.
    // On localhost there is no client IP, so all callers share one per-path
    // bucket — a deliberately strict global throttle on credential endpoints.
    rateLimit: {
        enabled: true,
        window: 10,
        max: 100,
        customRules: {
            "/sign-in/email": { window: 60, max: 10 },
            "/sign-up/email": { window: 60, max: 5 },
            "/change-password": { window: 60, max: 5 },
            "/request-password-reset": { window: 60, max: 5 },
            "/reset-password": { window: 60, max: 10 },
        },
    },
    plugins: [
        bearer(),
        admin({
            ac: pontuallAc,
            roles: pontuallRoles,
            defaultRole: "employee",
            adminRoles: ["administrator", "admin"],
        }),
    ],
});
