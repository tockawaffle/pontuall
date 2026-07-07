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

export type DataExportEntry = {
    date: string;
    clockIn: string;
    lunchOut: string;
    lunchReturn: string;
    clockOut: string;
    totalHours: string;
};

export type DataExport = {
    employee: {
        name: string;
        email: string | null;
        phone: string | null;
        role: string;
        lunchTime: string | null;
        createdAt: string;
    };
    timeEntries: DataExportEntry[];
};

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Sends the employee a copy of their personal data and punch history on
 * termination (LGPD Art. 18, II and V). The JSON attachment is the
 * machine-readable (portable) copy; the HTML table is the human-readable one.
 */
export async function sendDataExportEmail(
    config: SmtpConfig,
    to: string,
    dataExport: DataExport,
): Promise<void> {
    const { employee, timeEntries } = dataExport;
    const name = escapeHtml(employee.name);

    const rows = timeEntries
        .map(
            (e) => `
            <tr>
                <td>${escapeHtml(e.date)}</td>
                <td>${escapeHtml(e.clockIn)}</td>
                <td>${escapeHtml(e.lunchOut)}</td>
                <td>${escapeHtml(e.lunchReturn)}</td>
                <td>${escapeHtml(e.clockOut)}</td>
                <td>${escapeHtml(e.totalHours)}</td>
            </tr>`,
        )
        .join("");

    const transporter = createTransporter(config);
    await transporter.sendMail({
        from: config.from,
        to,
        subject: "PontuAll — cópia dos seus dados e registros de ponto",
        text: [
            `Olá, ${employee.name}.`,
            "",
            "Conforme a Lei Geral de Proteção de Dados (LGPD, Art. 18), segue em anexo",
            "uma cópia dos seus dados cadastrais e de todos os seus registros de ponto.",
            "",
            `Registros de ponto: ${timeEntries.length} dia(s).`,
            "",
            "Guarde este e-mail: ele é o seu comprovante dos horários registrados.",
        ].join("\n"),
        html: `
            <p>Olá, <strong>${name}</strong>.</p>
            <p>Conforme a Lei Geral de Proteção de Dados (LGPD, Art. 18), segue uma cópia
            dos seus dados cadastrais e de todos os seus registros de ponto. O anexo
            <code>meus-dados.json</code> contém os mesmos dados em formato portável.</p>
            <p><strong>Dados cadastrais</strong></p>
            <ul>
                <li>Nome: ${name}</li>
                <li>E-mail: ${escapeHtml(employee.email ?? "—")}</li>
                <li>Telefone: ${escapeHtml(employee.phone ?? "—")}</li>
                <li>Cargo: ${escapeHtml(employee.role)}</li>
            </ul>
            <p><strong>Registros de ponto (${timeEntries.length} dia(s))</strong></p>
            <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">
                <tr>
                    <th>Data</th><th>Entrada</th><th>Almoço — saída</th>
                    <th>Almoço — retorno</th><th>Saída</th><th>Total</th>
                </tr>${rows}
            </table>
            <p style="color:#666;font-size:12px">Guarde este e-mail: ele é o seu comprovante
            dos horários registrados.</p>
        `,
        attachments: [
            {
                filename: "meus-dados.json",
                content: JSON.stringify(dataExport, null, 2),
                contentType: "application/json",
            },
        ],
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
