// Minimal self-contained page for the one-time password link. Served by the
// sidecar itself so no extra hosting is needed; it posts to the Better Auth
// reset endpoint on the same origin.
export const RESET_PASSWORD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PontuAll — Definir senha</title>
<style>
    body { font-family: system-ui, sans-serif; background: #f4f4f5; margin: 0;
           display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.1);
            padding: 32px; width: 100%; max-width: 380px; margin: 16px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    p.sub { color: #666; font-size: 14px; margin: 0 0 20px; }
    label { display: block; font-size: 14px; font-weight: 500; margin: 12px 0 4px; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; font-size: 15px;
            border: 1px solid #d4d4d8; border-radius: 8px; }
    button { width: 100%; margin-top: 20px; padding: 12px; font-size: 15px; font-weight: 600;
             background: #1a1a2e; color: #fff; border: 0; border-radius: 8px; cursor: pointer; }
    button:disabled { opacity: .6; cursor: default; }
    .msg { margin-top: 16px; font-size: 14px; padding: 10px 12px; border-radius: 8px; display: none; }
    .msg.error { display: block; background: #fee2e2; color: #991b1b; }
    .msg.success { display: block; background: #dcfce7; color: #166534; }
</style>
</head>
<body>
<div class="card">
    <h1>Definir senha</h1>
    <p class="sub">PontuAll — controle de ponto</p>
    <form id="form">
        <label for="password">Nova senha</label>
        <input id="password" type="password" minlength="10" required
               placeholder="Mínimo de 10 caracteres" autocomplete="new-password">
        <label for="confirm">Confirmar senha</label>
        <input id="confirm" type="password" minlength="10" required
               placeholder="Repita a senha" autocomplete="new-password">
        <button id="submit" type="submit">Salvar senha</button>
    </form>
    <div id="msg" class="msg"></div>
</div>
<script>
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    const form = document.getElementById("form");
    const msg = document.getElementById("msg");
    const submit = document.getElementById("submit");

    function show(kind, text) {
        msg.className = "msg " + kind;
        msg.textContent = text;
    }

    if (!token) {
        form.style.display = "none";
        show("error", "Link inválido — solicite um novo ao administrador.");
    }

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const password = document.getElementById("password").value;
        const confirm = document.getElementById("confirm").value;
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
                form.style.display = "none";
                show("success", "Senha definida com sucesso. Você já pode entrar no PontuAll.");
            } else {
                const body = await res.json().catch(() => null);
                show("error", (body && body.message) ||
                    "Link expirado ou já utilizado — solicite um novo ao administrador.");
                submit.disabled = false;
            }
        } catch {
            show("error", "Falha de conexão — tente novamente.");
            submit.disabled = false;
        }
    });
</script>
</body>
</html>`;
