import type { PrismaClient } from "../generated/client/client";

/** Generated from prisma/schema.prisma via `prisma migrate diff --from-empty --to-schema`. */
const AUTH_SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS "public";

CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,
    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_key" ON "user"("email");
CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "session_token_key" ON "session"("token");
CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account"("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification"("identifier");

DO $$ BEGIN
    ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

const ADMIN_COLUMN_PATCHES = [
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" TEXT`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banned" BOOLEAN DEFAULT false`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banReason" TEXT`,
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "banExpires" TIMESTAMP(3)`,
    `ALTER TABLE "session" ADD COLUMN IF NOT EXISTS "impersonatedBy" TEXT`,
];

// Append-only, hash-chained audit trail (LGPD Art. 6º, X). Rows are never
// updated or deleted; `seq` gives the strict insertion order the chain
// verification walks.
const AUTH_AUDIT_TABLE = `
CREATE TABLE IF NOT EXISTS auth_audit_log (
    id TEXT PRIMARY KEY,
    seq BIGSERIAL,
    actor_id TEXT,
    actor_name TEXT,
    actor_type TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT,
    success BOOLEAN NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    payload_hash TEXT NOT NULL,
    prev_hash TEXT,
    self_hash TEXT NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS auth_audit_log_seq_idx ON auth_audit_log(seq);
CREATE INDEX IF NOT EXISTS auth_audit_log_actor_idx ON auth_audit_log(actor_id, created_at);
`;

const PUNCH_OTP_TABLE = `
CREATE TABLE IF NOT EXISTS punch_otp (
    id TEXT PRIMARY KEY,
    auth_user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    verify_attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS punch_otp_auth_user_id_idx ON punch_otp(auth_user_id);
`;

async function authTablesExist(prisma: PrismaClient): Promise<boolean> {
    const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'user'
        ) AS "exists"
    `);
    return Boolean(rows[0]?.exists);
}

/** Create or upgrade Better Auth tables before serving; idempotent across restarts. */
export async function ensureAuthSchema(prisma: PrismaClient): Promise<void> {
    const exists = await authTablesExist(prisma);
    if (!exists) {
        await prisma.$executeRawUnsafe(AUTH_SCHEMA_SQL);
        await prisma.$executeRawUnsafe(PUNCH_OTP_TABLE);
        await prisma.$executeRawUnsafe(AUTH_AUDIT_TABLE);
        console.log("auth schema initialized");
        return;
    }

    for (const patch of ADMIN_COLUMN_PATCHES) {
        await prisma.$executeRawUnsafe(patch);
    }

    await prisma.$executeRawUnsafe(PUNCH_OTP_TABLE);
    await prisma.$executeRawUnsafe(AUTH_AUDIT_TABLE);
}
