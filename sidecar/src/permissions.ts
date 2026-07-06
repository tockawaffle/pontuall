import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

/**
 * PontuAll application permissions for the Better Auth admin plugin.
 */
export const pontuallStatement = {
    ...defaultStatements,
    punch: [
        "read-self",
        "read-others",
        "write-self",
        "write-others",
        "delete-self",
        "delete-others",
    ],
    hours: ["edit"],
    hierarchy: ["manage"],
    reports: ["create"],
    card: ["provision", "master-key"],
} as const;

export const pontuallAc = createAccessControl(pontuallStatement);

export const employeeRole = pontuallAc.newRole({
    punch: ["read-self", "write-self"],
});

export const supervisorRole = pontuallAc.newRole({
    punch: ["read-self", "read-others", "write-self", "write-others"],
    hours: ["edit"],
    reports: ["create"],
    card: ["provision"],
});

export const administratorRole = pontuallAc.newRole({
    punch: [
        "read-self",
        "read-others",
        "write-self",
        "write-others",
        "delete-self",
        "delete-others",
    ],
    hours: ["edit"],
    hierarchy: ["manage"],
    reports: ["create"],
    card: ["provision", "master-key"],
    ...adminAc.statements,
});

export const userRole = pontuallAc.newRole({
    punch: ["read-self", "write-self"],
});

export const pontuallRoles = {
    user: userRole,
    employee: employeeRole,
    supervisor: supervisorRole,
    administrator: administratorRole,
    admin: administratorRole,
} as const;
