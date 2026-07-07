// Client script for the one-time password-setup page (opened from the
// e-mailed link); posts to the Better Auth reset endpoint on the same origin.
import { el } from "./dom";

const token = new URLSearchParams(location.search).get("token");

const form = el<HTMLFormElement>("form");
const msg = el<HTMLDivElement>("msg");
const submit = el<HTMLButtonElement>("submit");

function show(kind: "error" | "success", text: string): void {
    msg.className = `msg ${kind}`;
    msg.textContent = text;
}

if (!token) {
    form.hidden = true;
    show("error", "Link inválido — solicite um novo ao administrador.");
}

form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = el<HTMLInputElement>("password").value;
    const confirm = el<HTMLInputElement>("confirm").value;
    if (password.length < 10) {
        show("error", "A senha precisa ter pelo menos 10 caracteres.");
        return;
    }
    if (password !== confirm) {
        show("error", "As senhas não conferem.");
        return;
    }
    submit.disabled = true;
    try {
        const res = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newPassword: password, token }),
        });
        if (res.ok) {
            form.hidden = true;
            show("success", "Senha definida com sucesso. Você já pode entrar no PontuAll.");
        } else {
            const body = (await res.json().catch(() => null)) as { message?: string } | null;
            show(
                "error",
                body?.message ??
                    "Link expirado ou já utilizado — solicite um novo ao administrador.",
            );
            submit.disabled = false;
        }
    } catch {
        show("error", "Falha de conexão — tente novamente.");
        submit.disabled = false;
    }
});
