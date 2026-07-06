import React, {useCallback, useEffect, useState} from "react";
import TauriApi from "@/lib/Tauri";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {ShieldCheck} from "lucide-react";
import {toast} from "sonner";

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
    "sign-in/email": "Login",
    "sign-out": "Logout",
    "sign-up/email": "Cadastro de conta",
    "change-password": "Troca de senha",
    "request-password-reset": "Solicitação de link de senha",
    "reset-password": "Senha definida via link",
    "admin/create-user": "Criação de conta",
    "admin/set-role": "Alteração de perfil",
    "admin/set-user-password": "Senha redefinida (admin)",
    "admin/ban-user": "Suspensão de conta",
    "admin/unban-user": "Reativação de conta",
    "admin/remove-user": "Remoção de conta",
    "admin/list-users": "Listagem de contas",
    "internal/set-user-role": "Alteração de perfil",
    "internal/promote-auth-admin": "Promoção a administrador",
    "internal/password-setup-send": "Envio de link de senha",
};

function actorLabel(entry: AuditEntry): string {
    if (entry.actor_name) return entry.actor_name;
    return entry.actor_type === "system" ? "Sistema" : "—";
}

export default function AuditLog() {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);

    const load = useCallback(async (offset: number) => {
        setLoading(true);
        try {
            const result = await TauriApi.ListAuditLog(PAGE_SIZE, offset);
            setEntries((prev) =>
                offset === 0 ? result.entries : [...prev, ...result.entries]
            );
            setTotal(result.total);
        } catch (e: any) {
            toast.error("Não foi possível carregar a auditoria", {
                description: e?.message ?? String(e),
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load(0);
    }, [load]);

    async function handleVerify() {
        setVerifying(true);
        try {
            const result = await TauriApi.VerifyAuditLog();
            if (result.ok) {
                toast.success("Integridade confirmada", {
                    description: `${result.total} registros verificados — nenhuma alteração detectada.`,
                });
            } else {
                toast.error("Alteração detectada no histórico!", {
                    description: `A cadeia de verificação quebra no registro ${result.brokenAtId}.`,
                });
            }
        } catch (e: any) {
            toast.error("Erro ao verificar integridade", {
                description: e?.message ?? String(e),
            });
        } finally {
            setVerifying(false);
        }
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                    {total} registro(s) — o histórico é imutável e cada entrada é
                    encadeada à anterior por hash.
                </p>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void load(0)}
                        disabled={loading}
                    >
                        Atualizar
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void handleVerify()}
                        disabled={verifying}
                    >
                        <ShieldCheck className="h-4 w-4"/>
                        {verifying ? "Verificando…" : "Verificar integridade"}
                    </Button>
                </div>
            </div>

            <div className="border rounded-md overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Ação</TableHead>
                            <TableHead>Autor</TableHead>
                            <TableHead>Alvo</TableHead>
                            <TableHead>Resultado</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading && entries.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                    Carregando auditoria…
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading && entries.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                                    Nenhum evento registrado ainda.
                                </TableCell>
                            </TableRow>
                        )}
                        {entries.map((entry) => (
                            <TableRow key={entry.id}>
                                <TableCell className="whitespace-nowrap">
                                    {new Date(entry.created_at).toLocaleString("pt-BR")}
                                </TableCell>
                                <TableCell>
                                    {ACTION_LABELS[entry.action] ?? entry.action}
                                </TableCell>
                                <TableCell>{actorLabel(entry)}</TableCell>
                                <TableCell className="text-muted-foreground">
                                    {entry.resource ?? "—"}
                                </TableCell>
                                <TableCell>
                                    {entry.success ? (
                                        <Badge variant="secondary">OK</Badge>
                                    ) : (
                                        <Badge variant="destructive">Falha</Badge>
                                    )}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </div>

            {entries.length < total && (
                <Button
                    variant="outline"
                    className="w-full"
                    disabled={loading}
                    onClick={() => void load(entries.length)}
                >
                    {loading ? "Carregando…" : "Carregar mais"}
                </Button>
            )}
        </div>
    );
}
