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
        excludeFromReport: boolean;
    };
    timeEntries: PortalTimeEntry[];
    generatedAt: string;
    accessLevel: "employee" | "supervisor" | "administrator";
};

const loginForm = el<HTMLFormElement>("login");
const forgotDiv = el<HTMLDivElement>("forgot");
const forgotForm = el<HTMLFormElement>("forgot-form");
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

function renderEntries(): void {
    if (!exportData) return;

    const monthSel = el<HTMLSelectElement>("filter-month").value;
    const yearSel = el<HTMLSelectElement>("filter-year").value;

    const filtered = exportData.timeEntries.filter((e) => {
        if (monthSel && e.date.slice(5, 7) !== monthSel) return false;
        if (yearSel && e.date.slice(0, 4) !== yearSel) return false;
        return true;
    });

    const tbody = el<HTMLTableSectionElement>("entries");
    tbody.innerHTML = "";
    for (const entry of filtered) {
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

    const noEntries = el<HTMLParagraphElement>("no-entries");
    noEntries.hidden = filtered.length > 0;
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

    // Populate year dropdown from available data (deduplicated, descending).
    const yearSel = el<HTMLSelectElement>("filter-year");
    const years = [...new Set(data.timeEntries.map((e) => e.date.slice(0, 4)))].sort(
        (a, b) => Number(b) - Number(a),
    );
    yearSel.innerHTML = '<option value="">Todos os anos</option>';
    for (const year of years) {
        const opt = document.createElement("option");
        opt.value = year;
        opt.textContent = year;
        yearSel.append(opt);
    }

    renderEntries();

    loginForm.hidden = true;
    el<HTMLParagraphElement>("forgot-link").hidden = true;
    portal.hidden = false;

    const adminBlock = el<HTMLDivElement>("admin-report-visibility");
    const reportChk = el<HTMLInputElement>("report-visibility");
    if (data.accessLevel === "administrator") {
        adminBlock.hidden = false;
        reportChk.checked = data.employee.excludeFromReport;
        el<HTMLDivElement>("admin-panel").hidden = false;
        void loadAdminEmployees();
    } else {
        adminBlock.hidden = true;
        el<HTMLDivElement>("admin-panel").hidden = true;
    }
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

// --- Login ---

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

// --- Forgot password ---

el<HTMLAnchorElement>("forgot-link-btn").addEventListener("click", (e) => {
    e.preventDefault();
    clearMsg();
    loginForm.hidden = true;
    el<HTMLParagraphElement>("forgot-link").hidden = true;
    forgotDiv.hidden = false;
});

el<HTMLButtonElement>("forgot-back").addEventListener("click", () => {
    clearMsg();
    forgotDiv.hidden = true;
    loginForm.hidden = false;
    el<HTMLParagraphElement>("forgot-link").hidden = false;
});

forgotForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();
    const button = el<HTMLButtonElement>("forgot-submit");
    button.disabled = true;
    try {
        await fetch("/api/auth/request-password-reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: el<HTMLInputElement>("forgot-email").value }),
        });
    } catch {
        // fall through — always show the same message to prevent enumeration
    } finally {
        button.disabled = false;
    }
    show(
        "success",
        "Se este e-mail estiver cadastrado, você receberá um link em breve. Verifique também a caixa de spam.",
    );
    el<HTMLInputElement>("forgot-email").value = "";
});

// --- Portal actions ---

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
        await fetch("/api/auth/sign-out", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
        });
    } catch {
        // signing out of a dead session is fine
    }
    exportData = null;
    portal.hidden = true;
    loginForm.hidden = false;
    el<HTMLParagraphElement>("forgot-link").hidden = false;
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

// --- Filters ---

el<HTMLSelectElement>("filter-month").addEventListener("change", renderEntries);
el<HTMLSelectElement>("filter-year").addEventListener("change", renderEntries);

el<HTMLInputElement>("report-visibility").addEventListener("change", async (e) => {
    const checkbox = e.currentTarget as HTMLInputElement;
    clearMsg();
    try {
        const res = await fetch("/portal/admin/report-visibility", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ hidden: checkbox.checked }),
        });
        if (!res.ok) {
            checkbox.checked = !checkbox.checked;
            show("error", "Não foi possível salvar a preferência.");
            return;
        }
        if (exportData) exportData.employee.excludeFromReport = checkbox.checked;
        show("success", "Preferência salva.");
    } catch {
        checkbox.checked = !checkbox.checked;
        show("error", "Falha de conexão — tente novamente.");
    }
});

// --- Admin punch management ---

type AdminEntry = {
    date: string;
    clockIn: string | null;
    lunchOut: string | null;
    lunchReturn: string | null;
    clockOut: string | null;
    totalHours: string | null;
};

const FIELD_OF_INDEX: ("clockIn" | "lunchOut" | "lunchReturn" | "clockOut")[] = [
    "clockIn", "lunchOut", "lunchReturn", "clockOut",
];

async function loadAdminEmployees(): Promise<void> {
    const res = await fetch("/portal/admin/employees");
    if (!res.ok) return;
    const { employees } = (await res.json()) as { employees: { id: string; name: string }[] };
    const sel = el<HTMLSelectElement>("admin-employee");
    sel.innerHTML = '<option value="">Selecione um funcionário</option>';
    for (const emp of employees) {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.name;
        sel.append(opt);
    }
}

function timeInput(value: string | null): string {
    // ISO -> HH:MM for the <input type="time">.
    if (!value) return "";
    const d = new Date(value);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function loadAdminPunches(employeeId: string): Promise<void> {
    const tbody = el<HTMLTableSectionElement>("admin-entries");
    tbody.innerHTML = "";
    if (!employeeId) {
        el<HTMLParagraphElement>("admin-no-entries").hidden = true;
        return;
    }
    const res = await fetch(`/portal/admin/punches?employeeId=${encodeURIComponent(employeeId)}`);
    if (!res.ok) {
        show("error", "Não foi possível carregar os pontos.");
        return;
    }
    const { entries } = (await res.json()) as { entries: AdminEntry[] };
    el<HTMLParagraphElement>("admin-no-entries").hidden = entries.length > 0;
    for (const entry of entries) {
        const tr = document.createElement("tr");

        const dateTd = document.createElement("td");
        dateTd.textContent = fmtDate(entry.date);
        tr.append(dateTd);

        const values = [entry.clockIn, entry.lunchOut, entry.lunchReturn, entry.clockOut];
        values.forEach((value, i) => {
            const td = document.createElement("td");
            const input = document.createElement("input");
            input.type = "time";
            input.value = timeInput(value);
            input.addEventListener("change", () => {
                if (!input.value) return;
                void savePunch(employeeId, entry.date, FIELD_OF_INDEX[i], input.value);
            });
            td.append(input);
            tr.append(td);
        });

        const actionTd = document.createElement("td");
        const del = document.createElement("button");
        del.type = "button";
        del.className = "secondary";
        del.textContent = "Excluir dia";
        del.addEventListener("click", () => void deletePunch(employeeId, entry.date));
        actionTd.append(del);
        tr.append(actionTd);

        tbody.append(tr);
    }
}

async function savePunch(
    employeeId: string,
    dateISO: string,
    field: string,
    value: string,
): Promise<void> {
    clearMsg();
    const res = await fetch("/portal/admin/punch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: dateISO, field, value }),
    });
    if (res.ok) {
        show("success", "Ponto atualizado.");
    } else {
        show("error", "Não foi possível salvar o ponto.");
    }
}

async function deletePunch(employeeId: string, dateISO: string): Promise<void> {
    clearMsg();
    const res = await fetch("/portal/admin/punch/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: dateISO }),
    });
    if (res.ok) {
        show("success", "Dia excluído.");
        void loadAdminPunches(employeeId);
    } else {
        show("error", "Não foi possível excluir o dia.");
    }
}

el<HTMLSelectElement>("admin-employee").addEventListener("change", (e) => {
    void loadAdminPunches((e.currentTarget as HTMLSelectElement).value);
});

// Restore an existing session on load.
void fetchData().catch(() => undefined);
