import { createHash, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

import type { PrismaClient } from "../generated/client/client";
import { sendPunchOtpEmail, type SmtpConfig } from "./mail";

const OTP_TTL_MINUTES = 5;
const MAX_VERIFY_ATTEMPTS = 5;

function hashCode(code: string, secret: string): string {
    return createHash("sha256").update(`${secret}:${code}`).digest("hex");
}

function generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issuePunchOtp(
    prisma: PrismaClient,
    authUserId: string,
    email: string,
    employeeName: string,
    smtp: SmtpConfig,
    authSecret: string,
): Promise<void> {
    const code = generateCode();
    const codeHash = hashCode(code, authSecret);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
    const id = randomUUID();

    await prisma.$executeRaw`DELETE FROM punch_otp WHERE auth_user_id = ${authUserId}`;

    await prisma.$executeRaw`
        INSERT INTO punch_otp (id, auth_user_id, code_hash, expires_at, verify_attempts, created_at)
        VALUES (${id}, ${authUserId}, ${codeHash}, ${expiresAt}, 0, NOW())
    `;

    await sendPunchOtpEmail(smtp, email, employeeName, code, OTP_TTL_MINUTES);
}

export async function verifyPunchOtp(
    prisma: PrismaClient,
    authUserId: string,
    code: string,
    authSecret: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "locked" | "missing" }> {
    const rows = await prisma.$queryRaw<
        { id: string; code_hash: string; expires_at: Date; verify_attempts: number }[]
    >`
        SELECT id, code_hash, expires_at, verify_attempts
        FROM punch_otp
        WHERE auth_user_id = ${authUserId}
        ORDER BY created_at DESC
        LIMIT 1
    `;

    const row = rows[0];
    if (!row) {
        return { ok: false, reason: "missing" };
    }

    if (row.verify_attempts >= MAX_VERIFY_ATTEMPTS) {
        return { ok: false, reason: "locked" };
    }

    if (new Date(row.expires_at).getTime() < Date.now()) {
        await prisma.$executeRaw`DELETE FROM punch_otp WHERE id = ${row.id}`;
        return { ok: false, reason: "expired" };
    }

    const expected = Buffer.from(hashCode(code.trim(), authSecret), "hex");
    const stored = Buffer.from(row.code_hash, "hex");
    const matches = expected.length === stored.length && timingSafeEqual(expected, stored);
    if (!matches) {
        await prisma.$executeRaw`
            UPDATE punch_otp SET verify_attempts = verify_attempts + 1 WHERE id = ${row.id}
        `;
        return { ok: false, reason: "invalid" };
    }

    await prisma.$executeRaw`DELETE FROM punch_otp WHERE id = ${row.id}`;
    return { ok: true };
}
