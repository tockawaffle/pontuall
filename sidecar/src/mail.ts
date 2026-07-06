import nodemailer from "nodemailer";

export type SmtpConfig = {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
    from: string;
};

export function createTransporter(config: SmtpConfig) {
    return nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.pass,
        },
    });
}

export async function sendPunchOtpEmail(
    config: SmtpConfig,
    to: string,
    employeeName: string,
    code: string,
    expiresMinutes: number,
): Promise<void> {
    const transporter = createTransporter(config);
    await transporter.sendMail({
        from: config.from,
        to,
        subject: "PontuAll — código para bater ponto",
        text: [
            `Olá, ${employeeName}.`,
            "",
            `Seu código para bater ponto é: ${code}`,
            `Ele expira em ${expiresMinutes} minutos.`,
            "",
            "Se você não solicitou este código, ignore este e-mail.",
        ].join("\n"),
        html: `
            <p>Olá, <strong>${employeeName}</strong>.</p>
            <p>Seu código para bater ponto é:</p>
            <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
            <p>Ele expira em ${expiresMinutes} minutos.</p>
            <p style="color:#666;font-size:12px">Se você não solicitou este código, ignore este e-mail.</p>
        `,
    });
}

export async function sendPasswordSetupEmail(
    config: SmtpConfig,
    to: string,
    name: string,
    url: string,
    expiresHours: number,
): Promise<void> {
    const transporter = createTransporter(config);
    await transporter.sendMail({
        from: config.from,
        to,
        subject: "PontuAll — defina sua senha de acesso",
        text: [
            `Olá, ${name}.`,
            "",
            "Use o link abaixo para definir sua senha de acesso ao PontuAll:",
            url,
            "",
            `O link expira em ${expiresHours} horas e só pode ser usado uma vez.`,
            "",
            "Se você não esperava este e-mail, ignore-o.",
        ].join("\n"),
        html: `
            <p>Olá, <strong>${name}</strong>.</p>
            <p>Use o botão abaixo para definir sua senha de acesso ao PontuAll:</p>
            <p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;color:#fff;text-decoration:none;border-radius:6px">Definir senha</a></p>
            <p>Ou copie e cole este endereço no navegador:<br><a href="${url}">${url}</a></p>
            <p>O link expira em ${expiresHours} horas e só pode ser usado uma vez.</p>
            <p style="color:#666;font-size:12px">Se você não esperava este e-mail, ignore-o.</p>
        `,
    });
}

export async function sendSmtpTestEmail(config: SmtpConfig, to: string): Promise<void> {
    const transporter = createTransporter(config);
    await transporter.sendMail({
        from: config.from,
        to,
        subject: "PontuAll — teste de e-mail",
        text: "Configuração SMTP do PontuAll verificada com sucesso.",
    });
}
