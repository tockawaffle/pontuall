import { prisma } from "./db";

// Employee self-service portal ("Meus dados", LGPD Art. 18): served by the
// sidecar like the reset-password page, guarded by the employee's own Better
// Auth session. Data endpoints only ever return the caller's own records.
//
// The client pages live in real source files under portal/ (html, css and
// typed ts). Bun's HTML imports bundle the referenced scripts/stylesheets
// automatically, including into the compiled binary; the bundles are mounted
// as routes in Bun.serve (see index.ts).
import portalPage from "../portal/index.html";
import resetPage from "../portal/reset.html";

export { portalPage, resetPage };

type EmployeeRow = {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    role: string;
    lunch_time: string | null;
    created_at: Date;
    exclude_from_report: boolean;
};

type TimeEntryRow = {
    work_date: Date;
    clock_in: Date | null;
    lunch_out: Date | null;
    lunch_return: Date | null;
    clock_out: Date | null;
};

function totalHours(e: TimeEntryRow): string | null {
    if (!e.clock_in || !e.clock_out) return null;
    let ms = e.clock_out.getTime() - e.clock_in.getTime();
    if (e.lunch_out && e.lunch_return && e.lunch_return > e.lunch_out) {
        ms -= e.lunch_return.getTime() - e.lunch_out.getTime();
    }
    if (ms < 0) return null;
    const minutes = Math.floor(ms / 60_000);
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
}

/**
 * The caller's registration data and full punch history, or null when the
 * auth account has no linked employee. Timestamps stay ISO 8601 so the
 * downloaded JSON is machine-readable (Art. 18, V — portability).
 */
export async function loadPortalExport(authUserId: string): Promise<object | null> {
    const employees = await prisma.$queryRaw<EmployeeRow[]>`
        SELECT id, name, email, phone, role, lunch_time, created_at, exclude_from_report
        FROM employees WHERE auth_user_id = ${authUserId}
    `;
    const employee = employees[0];
    if (!employee) return null;

    const entries = await prisma.$queryRaw<TimeEntryRow[]>`
        SELECT work_date, clock_in, lunch_out, lunch_return, clock_out
        FROM time_entries WHERE employee_id = ${employee.id}
        ORDER BY work_date DESC
    `;

    return {
        employee: {
            name: employee.name,
            email: employee.email,
            phone: employee.phone,
            role: employee.role,
            lunchTime: employee.lunch_time,
            createdAt: employee.created_at.toISOString(),
            excludeFromReport: employee.exclude_from_report,
        },
        timeEntries: entries.map((e) => ({
            date: e.work_date.toISOString().slice(0, 10),
            clockIn: e.clock_in?.toISOString() ?? null,
            lunchOut: e.lunch_out?.toISOString() ?? null,
            lunchReturn: e.lunch_return?.toISOString() ?? null,
            clockOut: e.clock_out?.toISOString() ?? null,
            totalHours: totalHours(e),
        })),
        generatedAt: new Date().toISOString(),
    };
}

/** All employees, for the admin punch-management picker. */
export async function loadAdminEmployees(): Promise<
    { id: string; name: string; role: string }[]
> {
    return prisma.$queryRaw<{ id: string; name: string; role: string }[]>`
        SELECT id, name, role FROM employees ORDER BY name ASC
    `;
}

/** One employee's full punch history, same shape as loadPortalExport entries. */
export async function loadEmployeePunches(employeeId: string): Promise<
    {
        date: string;
        clockIn: string | null;
        lunchOut: string | null;
        lunchReturn: string | null;
        clockOut: string | null;
        totalHours: string | null;
    }[]
> {
    const entries = await prisma.$queryRaw<TimeEntryRow[]>`
        SELECT work_date, clock_in, lunch_out, lunch_return, clock_out
        FROM time_entries WHERE employee_id = ${employeeId}
        ORDER BY work_date DESC
    `;
    return entries.map((e) => ({
        date: e.work_date.toISOString().slice(0, 10),
        clockIn: e.clock_in?.toISOString() ?? null,
        lunchOut: e.lunch_out?.toISOString() ?? null,
        lunchReturn: e.lunch_return?.toISOString() ?? null,
        clockOut: e.clock_out?.toISOString() ?? null,
        totalHours: totalHours(e),
    }));
}

/** Sets the caller's own report-visibility flag. Returns rows affected. */
export async function setReportVisibility(
    authUserId: string,
    hidden: boolean,
): Promise<number> {
    const affected = await prisma.$executeRaw`
        UPDATE employees SET exclude_from_report = ${hidden}, updated_at = now()
        WHERE auth_user_id = ${authUserId}
    `;
    return affected;
}
