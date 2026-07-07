// Client script for the employee self-service portal ("Meus dados").
// The PortalData shape mirrors loadPortalExport() in src/portal.ts.
import { el } from "./dom";

type PortalTimeEntry = {
    date: string;
    clockIn: string | null;
    lunchOut: string | null;
    lunchReturn: string | null;
    clockOut: string | null;
    totalHours: string | null;
};

type PortalData = {
    employee: {
        name: string;
        email: string | null;
        phone: string | null;
        role: string;
        lunchTime: string | null;
        createdAt: string;
    };
    timeEntries: PortalTimeEntry[];
    generatedAt: string;
};

const loginForm = el<HTMLFormElement>("login");
const portal = el<HTMLDivElement>("portal");
const msg = el<HTMLDivElement>("msg");

let exportData: PortalData | null = null;

function show(kind: "error" | "success", text: string): void {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
}

function clearMsg(): void {
    msg.className = "msg";
}

function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(day: string): string {
    const [year, month, dayOfMonth] = day.split("-");
    return `${dayOfMonth}/${month}/${year}`;
}

function render(data: PortalData): void {
    exportData = data;

    const profile = el<HTMLDListElement>("profile");
    profile.innerHTML = "";
    const fields: [string, string | null][] = [
        ["Nome", data.employee.name],
        ["E-mail", data.employee.email],
        ["Telefone", data.employee.phone],
        ["Cargo", data.employee.role],
        ["Horário de almoço", data.employee.lunchTime],
    ];
    for (const [label, value] of fields) {
        const dt = document.createElement("dt");
        dt.textContent = label;
        const dd = document.createElement("dd");
        dd.textContent = value || "—";
        profile.append(dt, dd);
    }

    const tbody = el<HTMLTableSectionElement>("entries");
    tbody.innerHTML = "";
    for (const entry of data.timeEntries) {
        const cells = [
            fmtDate(entry.date),
            fmtTime(entry.clockIn),
            fmtTime(entry.lunchOut),
            fmtTime(entry.lunchReturn),
            fmtTime(entry.clockOut),
            entry.totalHours ?? "—",
        ];
        const tr = document.createElement("tr");
        for (const cell of cells) {
            const td = document.createElement("td");
            td.textContent = cell;
            tr.append(td);
        }
        tbody.append(tr);
    }

    loginForm.hidden = true;
    portal.hidden = false;
}

/** Loads the caller's data; false means there is no active session. */
async function fetchData(): Promise<boolean> {
    const res = await fetch("/portal/data");
    if (res.status === 401) return false;
    if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        show("error", body?.error ?? "Não foi possível carregar seus dados.");
        return true;
    }
    clearMsg();
    render((await res.json()) as PortalData);
    return true;
}

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const button = el<HTMLButtonElement>("login-submit");
    button.disabled = true;
    try {
        const res = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: el<HTMLInputElement>("email").value,
                password: el<HTMLInputElement>("password").value,
            }),
        });
        if (!res.ok) {
            show(
                "error",
                res.status === 429
                    ? "Muitas tentativas — aguarde um minuto."
                    : "E-mail ou senha incorretos.",
            );
            return;
        }
        await fetchData();
    } catch {
        show("error", "Falha de conexão — tente novamente.");
    } finally {
        button.disabled = false;
    }
});

el<HTMLButtonElement>("download").addEventListener("click", () => {
    if (!exportData) return;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "meus-dados.json";
    a.click();
    URL.revokeObjectURL(a.href);
});

el<HTMLButtonElement>("signout").addEventListener("click", async () => {
    try {
        await fetch("/api/auth/sign-out", { method: "POST" });
    } catch {
        // signing out of a dead session is fine
    }
    exportData = null;
    portal.hidden = true;
    loginForm.hidden = false;
    clearMsg();
});

el<HTMLFormElement>("change-password").addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const button = el<HTMLButtonElement>("change-submit");
    button.disabled = true;
    try {
        const res = await fetch("/api/auth/change-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                currentPassword: el<HTMLInputElement>("current-password").value,
                newPassword: el<HTMLInputElement>("new-password").value,
                revokeOtherSessions: true,
            }),
        });
        if (res.ok) {
            show("success", "Senha alterada com sucesso.");
            el<HTMLInputElement>("current-password").value = "";
            el<HTMLInputElement>("new-password").value = "";
        } else {
            const body = (await res.json().catch(() => null)) as { message?: string } | null;
            show("error", body?.message ?? "Não foi possível alterar a senha.");
        }
    } catch {
        show("error", "Falha de conexão — tente novamente.");
    } finally {
        button.disabled = false;
    }
});

// Restore an existing session on load.
void fetchData().catch(() => undefined);
