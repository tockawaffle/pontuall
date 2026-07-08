import { prisma } from "./db";
import type { SmtpConfig } from "./mail";
import { sendMissedPunchEmail } from "./mail";

export type WorkHoursSchedule = {
    entry: string;           // "HH:MM" or "HH:MM:SS"
    exit: string;
    exitWeekend: string;
    toleranceMinutes: number;
};

function toMinutes(t: string): number {
    const parts = t.split(":").map(Number);
    return parts[0] * 60 + (parts[1] ?? 0);
}

function localDateStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowMinutes(): number {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
}

// Tracks sent checks per day to prevent duplicate notifications.
const sentChecks = new Map<string, Set<string>>();

function clearStale(): void {
    const today = localDateStr();
    for (const date of sentChecks.keys()) {
        if (date !== today) sentChecks.delete(date);
    }
}

function alreadySent(checkId: string): boolean {
    return sentChecks.get(localDateStr())?.has(checkId) ?? false;
}

function markSent(checkId: string): void {
    const today = localDateStr();
    if (!sentChecks.has(today)) sentChecks.set(today, new Set());
    sentChecks.get(today)!.add(checkId);
}

type IncompleteEntryRow = {
    name: string;
    email: string | null;
    clock_out: Date | null;
    lunch_out: Date | null;
    lunch_return: Date | null;
};

type LunchTimeRow = { lunch_time: string };

async function runLunchChecks(
    smtp: SmtpConfig,
    today: string,
    halfTolerance: number,
    nowMin: number,
): Promise<void> {
    const lunchTimes = await prisma.$queryRaw<LunchTimeRow[]>`
        SELECT DISTINCT lunch_time FROM employees
        WHERE lunch_time IS NOT NULL AND status = 'active'
    `;

    for (const { lunch_time } of lunchTimes) {
        const checkMin = toMinutes(lunch_time) + halfTolerance;
        const checkId = `lunch:${today}:${lunch_time}`;
        if (nowMin < checkMin || alreadySent(checkId)) continue;
        markSent(checkId);

        const rows = await prisma.$queryRaw<{ name: string; email: string | null }[]>`
            SELECT e.name, e.email
            FROM employees e
            JOIN time_entries t ON e.id = t.employee_id
            WHERE t.work_date = ${today}::date
              AND e.lunch_time = ${lunch_time}
              AND t.lunch_out IS NOT NULL
              AND t.lunch_return IS NULL
        `;

        for (const row of rows) {
            if (!row.email) continue;
            try {
                await sendMissedPunchEmail(smtp, row.email, row.name, today, ["Retorno do almoço"]);
            } catch (e) {
                console.error("[missed-punch] lunch notify failed:", e instanceof Error ? e.message : e);
            }
        }
    }
}

async function runExitCheck(smtp: SmtpConfig, today: string): Promise<void> {
    const rows = await prisma.$queryRaw<IncompleteEntryRow[]>`
        SELECT e.name, e.email, t.clock_out, t.lunch_out, t.lunch_return
        FROM employees e
        JOIN time_entries t ON e.id = t.employee_id
        WHERE t.work_date = ${today}::date
          AND t.clock_in IS NOT NULL
          AND (
              t.clock_out IS NULL
              OR (t.lunch_out IS NOT NULL AND t.lunch_return IS NULL)
          )
    `;

    for (const row of rows) {
        if (!row.email) continue;
        const missing: string[] = [];
        if (!row.clock_out) missing.push("Saída");
        if (row.lunch_out && !row.lunch_return) missing.push("Retorno do almoço");
        if (missing.length === 0) continue;
        try {
            await sendMissedPunchEmail(smtp, row.email, row.name, today, missing);
        } catch (e) {
            console.error("[missed-punch] exit notify failed:", e instanceof Error ? e.message : e);
        }
    }
}

let schedule: WorkHoursSchedule | null = null;

export function updateWorkHoursSchedule(s: WorkHoursSchedule): void {
    schedule = s;
}

export function startMissedPunchScheduler(getSmtp: () => SmtpConfig | null): void {
    setInterval(() => {
        void (async () => {
            if (!schedule) return;
            const smtp = getSmtp();
            if (!smtp) return;

            clearStale();
            const nowMin = nowMinutes();
            const today = localDateStr();
            const half = Math.floor(schedule.toleranceMinutes / 2);

            const exitCheckMin = toMinutes(schedule.exit) + half;
            const exitId = `exit:${today}`;
            if (nowMin >= exitCheckMin && !alreadySent(exitId)) {
                markSent(exitId);
                await runExitCheck(smtp, today).catch((e) =>
                    console.error("[missed-punch] exit check error:", e instanceof Error ? e.message : e),
                );
            }

            await runLunchChecks(smtp, today, half, nowMin).catch((e) =>
                console.error("[missed-punch] lunch check error:", e instanceof Error ? e.message : e),
            );
        })();
    }, 60_000);
}
