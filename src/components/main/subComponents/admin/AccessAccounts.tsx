import React, {useCallback, useEffect, useMemo, useState} from "react";
import TauriApi from "@/lib/Tauri";
import {
    ACCESS_LEVEL_LABELS,
    normalizeAccessLevel,
    type PontuallAccessLevel,
} from "@/lib/pontuall-permissions";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Alert, AlertDescription, AlertTitle} from "@/components/ui/alert";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {Badge} from "@/components/ui/badge";
import {AlertCircle, KeyRound, ShieldBan, ShieldCheck, Trash2} from "lucide-react";
import {toast} from "sonner";

interface AccessAccountsProps {
    employees: Users;
}

export default function AccessAccounts({employees}: AccessAccountsProps) {
    const [users, setUsers] = useState<AuthAccessUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");

    const [createOpen, setCreateOpen] = useState(false);
    const [createEmployeeId, setCreateEmployeeId] = useState("");
    const [createEmail, setCreateEmail] = useState("");
    const [createAccessLevel, setCreateAccessLevel] = useState<PontuallAccessLevel>("employee");

    const [resetUser, setResetUser] = useState<AuthAccessUser | null>(null);
    const [resetSending, setResetSending] = useState(false);

    const [confirmAction, setConfirmAction] = useState<
        { type: "ban" | "remove"; user: AuthAccessUser } | null
    >(null);
    const [roleSaving, setRoleSaving] = useState<string | null>(null);

    const employeesWithoutAccount = useMemo(() => {
        return employees.filter((e) => e.email && !e.auth_user_id);
    }, [employees]);

    const linkedEmployeeName = useCallback(
        (authUser: AuthAccessUser) => {
            const match = employees.find((e) => e.auth_user_id === authUser.id);
            if (match) return match.name;
            const byEmail = employees.find(
                (e) => e.email?.toLowerCase() === authUser.email.toLowerCase()
            );
            return byEmail?.name ?? "—";
        },
        [employees]
    );

    const loadUsers = useCallback(async () => {
        setLoading(true);
        try {
            const result = await TauriApi.ListAuthUsers();
            setUsers(result.users);
        } catch (e: any) {
            toast.error("Não foi possível carregar contas", {
                description: e?.message ?? String(e),
            });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const filteredUsers = search
        ? users.filter(
            (u) =>
                u.name.toLowerCase().includes(search.toLowerCase()) ||
                u.email.toLowerCase().includes(search.toLowerCase())
        )
        : users;

    async function handleCreateAccount() {
        if (!createEmployeeId || !createEmail) return;
        try {
            await TauriApi.CreateAccount(
                createEmployeeId,
                createEmail,
                createAccessLevel,
            );
            toast.success("Conta criada", {
                description: "Link para definir a senha enviado por e-mail.",
            });
            setCreateOpen(false);
            setCreateEmployeeId("");
            setCreateEmail("");
            setCreateAccessLevel("employee");
            await loadUsers();
        } catch (e: any) {
            toast.error("Erro ao criar conta", {description: e?.message ?? String(e)});
        }
    }

    async function handleSendPasswordReset() {
        if (!resetUser) return;
        setResetSending(true);
        try {
            await TauriApi.SendPasswordReset(resetUser.email);
            toast.success("Link enviado", {
                description: `${resetUser.email} recebeu um link para definir a nova senha.`,
            });
            setResetUser(null);
        } catch (e: any) {
            toast.error("Erro ao enviar link", {description: e?.message ?? String(e)});
        } finally {
            setResetSending(false);
        }
    }

    async function handleRoleChange(user: AuthAccessUser, role: PontuallAccessLevel) {
        if (normalizeAccessLevel(user.role) === role) return;
        setRoleSaving(user.id);
        try {
            await TauriApi.SetAuthUserRole(user.id, role);
            toast.success("Perfil atualizado");
            await loadUsers();
        } catch (e: any) {
            toast.error("Erro ao alterar perfil", {description: e?.message ?? String(e)});
        } finally {
            setRoleSaving(null);
        }
    }

    async function handleBan(user: AuthAccessUser) {
        setConfirmAction({type: "ban", user});
    }

    async function handleUnban(user: AuthAccessUser) {
        try {
            await TauriApi.UnbanAuthUser(user.id);
            toast.success("Conta reativada");
            await loadUsers();
        } catch (e: any) {
            toast.error("Erro ao reativar", {description: e?.message ?? String(e)});
        }
    }

    async function handleRemove(user: AuthAccessUser) {
        setConfirmAction({type: "remove", user});
    }

    async function executeConfirmedAction() {
        if (!confirmAction) return;
        const {type, user} = confirmAction;
        setConfirmAction(null);
        try {
            if (type === "ban") {
                await TauriApi.BanAuthUser(user.id);
                toast.success("Conta suspensa");
            } else {
                await TauriApi.RemoveAuthUser(user.id);
                toast.success("Conta removida");
            }
            await loadUsers();
        } catch (e: any) {
            toast.error(type === "ban" ? "Erro ao suspender" : "Erro ao remover", {
                description: e?.message ?? String(e),
            });
        }
    }

    return (
        <div className="space-y-4">
            {employeesWithoutAccount.length > 0 && (
                <Alert>
                    <AlertCircle/>
                    <AlertTitle>
                        {employeesWithoutAccount.length === 1
                            ? "1 login pendente"
                            : `${employeesWithoutAccount.length} logins pendentes`}
                    </AlertTitle>
                    <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <span>
                            Estes funcionários já estão cadastrados, mas ainda não têm senha de
                            acesso. Isso costuma ocorrer em migrações ou cadastros antigos.
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            className="shrink-0"
                            onClick={() => setCreateOpen(true)}
                        >
                            Resolver pendências
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Ativar login pendente</DialogTitle>
                        <DialogDescription>
                            Escolha o funcionário — ele receberá por e-mail um link de uso único
                            para definir a própria senha. Não cria um novo cadastro, apenas
                            habilita o acesso.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3">
                        <div>
                            <Label htmlFor="access-employee">Funcionário</Label>
                            <select
                                id="access-employee"
                                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                value={createEmployeeId}
                                onChange={(e) => {
                                    const id = e.target.value;
                                    setCreateEmployeeId(id);
                                    const emp = employees.find((x) => x.id === id);
                                    if (emp?.email) setCreateEmail(emp.email);
                                }}
                            >
                                <option value="">Selecione…</option>
                                {employeesWithoutAccount.map((e) => (
                                    <option key={e.id} value={e.id}>
                                        {e.name} {e.email ? `(${e.email})` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <Label htmlFor="access-email">E-mail de login</Label>
                            <Input
                                id="access-email"
                                type="email"
                                value={createEmail}
                                onChange={(e) => setCreateEmail(e.target.value)}
                            />
                        </div>
                                <div>
                                    <Label htmlFor="access-pending-level">Nível de acesso</Label>
                                    <select
                                        id="access-pending-level"
                                        className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                        value={createAccessLevel}
                                        onChange={(e) =>
                                            setCreateAccessLevel(e.target.value as PontuallAccessLevel)
                                        }
                                    >
                                        {(Object.keys(ACCESS_LEVEL_LABELS) as PontuallAccessLevel[]).map(
                                            (level) => (
                                                <option key={level} value={level}>
                                                    {ACCESS_LEVEL_LABELS[level]}
                                                </option>
                                            )
                                        )}
                                    </select>
                                </div>
                            </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleCreateAccount}
                            disabled={!createEmployeeId || !createEmail}
                        >
                            Ativar e enviar link
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <Input
                    placeholder="Buscar por nome ou e-mail"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="max-w-sm"
                />
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => loadUsers()} disabled={loading}>
                        Atualizar
                    </Button>
                </div>
            </div>

            <div className="border rounded-md overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Nome</TableHead>
                            <TableHead>E-mail</TableHead>
                            <TableHead>Funcionário</TableHead>
                            <TableHead>Perfil</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                    Carregando contas…
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading && filteredUsers.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                    Nenhuma conta de acesso encontrada.
                                </TableCell>
                            </TableRow>
                        )}
                        {!loading &&
                            filteredUsers.map((user) => (
                                <TableRow key={user.id}>
                                    <TableCell>{user.name}</TableCell>
                                    <TableCell>{user.email}</TableCell>
                                    <TableCell>{linkedEmployeeName(user)}</TableCell>
                                    <TableCell>
                                        <select
                                            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                                            value={normalizeAccessLevel(user.role)}
                                            disabled={roleSaving === user.id || Boolean(user.banned)}
                                            onChange={(e) =>
                                                handleRoleChange(
                                                    user,
                                                    e.target.value as PontuallAccessLevel
                                                )
                                            }
                                        >
                                            {(Object.keys(ACCESS_LEVEL_LABELS) as PontuallAccessLevel[]).map(
                                                (level) => (
                                                    <option key={level} value={level}>
                                                        {ACCESS_LEVEL_LABELS[level]}
                                                    </option>
                                                )
                                            )}
                                        </select>
                                    </TableCell>
                                    <TableCell>
                                        {user.banned ? (
                                            <Badge variant="destructive">Suspensa</Badge>
                                        ) : (
                                            <Badge variant="secondary">Ativa</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title="Enviar link de senha"
                                                onClick={() => setResetUser(user)}
                                            >
                                                <KeyRound className="h-4 w-4"/>
                                            </Button>
                                            {user.banned ? (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Reativar"
                                                    onClick={() => handleUnban(user)}
                                                >
                                                    <ShieldCheck className="h-4 w-4"/>
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    title="Suspender"
                                                    onClick={() => handleBan(user)}
                                                >
                                                    <ShieldBan className="h-4 w-4"/>
                                                </Button>
                                            )}
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                title="Remover conta"
                                                onClick={() => handleRemove(user)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive"/>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                    </TableBody>
                </Table>
            </div>

            <Dialog open={resetUser !== null} onOpenChange={(open) => !open && setResetUser(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Enviar link de senha</DialogTitle>
                        <DialogDescription>
                            {resetUser &&
                                `${resetUser.name} receberá em ${resetUser.email} um link de uso único para definir a nova senha. A senha atual continua válida até a troca.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResetUser(null)} disabled={resetSending}>
                            Cancelar
                        </Button>
                        <Button onClick={handleSendPasswordReset} disabled={resetSending}>
                            {resetSending ? "Enviando…" : "Enviar link"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmAction !== null} onOpenChange={(open) => !open && setConfirmAction(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {confirmAction?.type === "ban" ? "Suspender conta" : "Remover conta"}
                        </DialogTitle>
                        <DialogDescription>
                            {confirmAction?.type === "ban"
                                ? `Suspender o acesso de ${confirmAction.user.name}?`
                                : `Remover permanentemente a conta de ${confirmAction?.user.name}? O funcionário vinculado permanece no sistema.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setConfirmAction(null)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={executeConfirmedAction}>
                            Confirmar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
