/** Better Auth role names used by PontuAll (mirrors sidecar/src/permissions.ts). */
export type PontuallAuthRole = "user" | "employee" | "supervisor" | "administrator" | "admin";

export type PontuallAccessLevel = "employee" | "supervisor" | "administrator";

export const ACCESS_LEVEL_LABELS: Record<PontuallAccessLevel, string> = {
    employee: "Funcionário",
    supervisor: "Supervisor",
    administrator: "Administrador",
};

/** Normalize Better Auth role strings to PontuAll access levels. */
export function normalizeAccessLevel(role?: string | null): PontuallAccessLevel {
    const value = (role ?? "employee").toLowerCase();
    if (value.includes("admin")) return "administrator";
    if (value.includes("supervisor")) return "supervisor";
    return "employee";
}

/** Capabilities resolved from the active Better Auth session. */
export type SessionCapabilities = {
    punchReadSelf: boolean;
    punchReadOthers: boolean;
    punchWriteSelf: boolean;
    punchWriteOthers: boolean;
    hoursEdit: boolean;
    hierarchyManage: boolean;
    reportsCreate: boolean;
    cardProvision: boolean;
};

export function canAccessAdmin(caps: SessionCapabilities): boolean {
    return caps.hierarchyManage || caps.punchWriteOthers;
}

export function canEditPunches(caps: SessionCapabilities): boolean {
    return (
        caps.punchReadSelf &&
        caps.punchWriteSelf &&
        caps.punchReadOthers &&
        caps.punchWriteOthers &&
        caps.hoursEdit
    );
}
