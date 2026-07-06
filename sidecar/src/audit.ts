import { createHash, randomUUID } from "node:crypto";

import { auth } from "./auth";
import { prisma } from "./db";

// Hash-chained, append-only audit trail (LGPD Art. 6º, X). Only event
// metadata and a payload hash are stored — never credentials or full PII
// (e-mails are masked).

export type AuditEvent = {
    actorId?: string | null;
    actorName?: string | null;
    actorType: "admin" | "user" | "system";
    action: string;
    resource?: string | null;
    success: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
    /** Already sanitized (no secrets, masked PII) — only its hash is stored. */
    payload?: unknown;
};

export function maskEmail(value: string): string {
    const [local, domain] = value.split("@");
    if (!domain) return "***";
    return `${local.slice(0, 2)}***@${domain}`;
}

// Serializes writes so prev_hash always points at the latest row even when
// several requests log concurrently.
let chainTail: Promise<void> = Promise.resolve();

export function logAudit(event: AuditEvent): Promise<void> {
    const write = chainTail
        .then(() => writeEntry(event))
        .catch((e) => {
            console.error("[audit] write failed:", e instanceof Error ? e.message : e);
        });
    chainTail = write;
    return write;
}

async function writeEntry(event: AuditEvent): Promise<void> {
    const rows = await prisma.$queryRaw<{ self_hash: string }[]>`
        SELECT self_hash FROM auth_audit_log ORDER BY seq DESC LIMIT 1
    `;
    const prevHash = rows[0]?.self_hash ?? null;
    const createdAt = new Date();
    const payloadHash = createHash("sha256")
        .update(JSON.stringify(event.payload ?? {}))
        .digest("hex");
    const selfHash = computeSelfHash(
        prevHash,
        createdAt,
        event.action,
        event.resource ?? null,
        payloadHash,
    );

    await prisma.$executeRaw`
        INSERT INTO auth_audit_log
            (id, actor_id, actor_name, actor_type, action, resource, success,
             ip_address, user_agent, payload_hash, prev_hash, self_hash, created_at)
        VALUES
            (${randomUUID()}, ${event.actorId ?? null}, ${event.actorName ?? null},
             ${event.actorType}, ${event.action}, ${event.resource ?? null},
             ${event.success}, ${event.ipAddress ?? null}, ${event.userAgent ?? null},
             ${payloadHash}, ${prevHash}, ${selfHash}, ${createdAt})
    `;
}

function computeSelfHash(
    prevHash: string | null,
    createdAt: Date,
    action: string,
    resource: string | null,
    payloadHash: string,
): string {
    return createHash("sha256")
        .update(`${prevHash ?? ""}|${createdAt.toISOString()}|${action}|${resource ?? ""}|${payloadHash}`)
        .digest("hex");
}

export type AuditListEntry = {
    id: string;
    actor_id: string | null;
    actor_name: string | null;
    actor_type: string;
    action: string;
    resource: string | null;
    success: boolean;
    ip_address: string | null;
    created_at: Date;
};

export async function listAudit(
    limit: number,
    offset: number,
): Promise<{ entries: AuditListEntry[]; total: number }> {
    const entries = await prisma.$queryRaw<AuditListEntry[]>`
        SELECT id, actor_id, actor_name, actor_type, action, resource, success,
               ip_address, created_at
        FROM auth_audit_log
        ORDER BY seq DESC
        LIMIT ${limit} OFFSET ${offset}
    `;
    const counted = await prisma.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*)::int AS total FROM auth_audit_log
    `;
    return { entries, total: counted[0]?.total ?? 0 };
}

/** Walks the whole chain recomputing hashes; any divergence means tampering. */
export async function verifyAuditChain(): Promise<{
    ok: boolean;
    total: number;
    brokenAtId: string | null;
}> {
    const rows = await prisma.$queryRaw<
        {
            id: string;
            action: string;
            resource: string | null;
            payload_hash: string;
            prev_hash: string | null;
            self_hash: string;
            created_at: Date;
        }[]
    >`
        SELECT id, action, resource, payload_hash, prev_hash, self_hash, created_at
        FROM auth_audit_log
        ORDER BY seq ASC
    `;

    let prev: string | null = null;
    for (const row of rows) {
        const expected = computeSelfHash(
            prev,
            new Date(row.created_at),
            row.action,
            row.resource,
            row.payload_hash,
        );
        if (row.prev_hash !== prev || row.self_hash !== expected) {
            return { ok: false, total: rows.length, brokenAtId: row.id };
        }
        prev = row.self_hash;
    }
    return { ok: true, total: rows.length, brokenAtId: null };
}

const SECRET_FIELDS = new Set(["password", "newPassword", "currentPassword", "token"]);

/** Better Auth admin roles get actorType "admin" in the trail. */
const ADMIN_ROLES = new Set(["administrator", "admin"]);

/**
 * Resolves the acting session (bearer) and records one Better Auth API call.
 * Call with the actor resolved BEFORE the handler runs, since e.g. sign-out
 * destroys the session it acted on.
 */
export async function resolveApiActor(
    request: Request,
): Promise<{ actorId: string | null; actorName: string | null; actorType: "admin" | "user" }> {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (session?.user) {
            const role = (session.user as { role?: string | null }).role ?? "";
            return {
                actorId: session.user.id,
                actorName: session.user.name ?? null,
                actorType: ADMIN_ROLES.has(role) ? "admin" : "user",
            };
        }
    } catch {
        // fall through: unauthenticated caller (e.g. sign-in, reset page)
    }
    return { actorId: null, actorName: null, actorType: "user" };
}

export function logAuthApiEvent(
    request: Request,
    pathname: string,
    payload: Record<string, unknown>,
    actor: { actorId: string | null; actorName: string | null; actorType: "admin" | "user" },
    status: number,
    ip: string | null,
): void {
    const action = pathname.replace(/^\/api\/auth\//, "");

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
        if (SECRET_FIELDS.has(key)) continue;
        sanitized[key] =
            typeof value === "string" && key.toLowerCase().includes("email")
                ? maskEmail(value)
                : value;
    }

    const resource =
        typeof payload.userId === "string"
            ? `user:${payload.userId}`
            : typeof payload.email === "string"
                ? maskEmail(payload.email)
                : null;

    void logAudit({
        ...actor,
        action,
        resource,
        success: status < 400,
        ipAddress: ip,
        userAgent: request.headers.get("user-agent"),
        payload: sanitized,
    });
}
