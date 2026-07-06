export type PunchStatus = "absent" | "working" | "lunch" | "done";

export function getTimeGreeting(hour: number): string {
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
}

export function formatTodayDate(timezone: string, locale = "pt-BR"): string {
    return new Date().toLocaleDateString(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: timezone || "America/Sao_Paulo",
    });
}

export function getTodayKey(locale = "pt-BR"): string {
    return new Date().toLocaleDateString(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
    });
}

export function getPunchStatus(userData?: HourData | null): PunchStatus {
    if (!userData?.clock_in || userData.clock_in === "N/A") return "absent";
    if (userData.clocked_out && userData.clocked_out !== "N/A") return "done";
    if (userData.lunch_break_out && userData.lunch_break_out !== "N/A" &&
        (!userData.lunch_break_return || userData.lunch_break_return === "N/A")) {
        return "lunch";
    }
    return "working";
}

export const PUNCH_STATUS_LABEL: Record<PunchStatus, string> = {
    absent: "Ausente",
    working: "Presente",
    lunch: "Almoço",
    done: "Concluído",
};

export function countByStatus(users: Users, today: string): Record<PunchStatus, number> {
    const counts: Record<PunchStatus, number> = {absent: 0, working: 0, lunch: 0, done: 0};

    for (const user of users) {
        const userData = user.hour_data?.[today];
        counts[getPunchStatus(userData)]++;
    }

    return counts;
}
