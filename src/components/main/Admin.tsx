import React, {useEffect, useMemo, useState} from "react";
import Link from "next/link";
import {useRouter} from "next/router";
import {
    ArrowLeft,
    BarChart3,
    FileText,
    KeyRound,
    Layers,
    ScrollText,
    Search,
    UserPlus,
    Users,
} from "lucide-react";
import TauriApi from "@/lib/Tauri";
import {useApp} from "@/contexts/app-context";
import {getTodayKey} from "@/lib/home-display";
import Employees from "@/components/main/subComponents/admin/employees";
import AddEmployee, {AddEmployeeTrigger} from "@/components/main/subComponents/admin/addEmployee";
import AccessAccounts from "@/components/main/subComponents/admin/AccessAccounts";
import AuditLog from "@/components/main/subComponents/admin/AuditLog";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Checkbox} from "@/components/ui/checkbox";
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {toast} from "sonner";

enum Keys {
    ClockIn = "ClockIn",
    ClockLunchOut = "ClockLunchOut",
    ClockLunchReturn = "ClockLunchReturn",
    ClockOut = "ClockOut",
}

function StatCard({
    label,
    value,
    hint,
}: {
    label: string;
    value: string | number;
    hint: string;
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardDescription>{label}</CardDescription>
                <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </CardContent>
        </Card>
    );
}

export default function AdminPage() {
    const router = useRouter();
    const {users, setUsers, workHours, refreshUsers, sessionStatus} = useApp();

    const [capabilities, setCapabilities] = useState<SessionCapabilities | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedEmployee, setSelectedEmployee] = useState<IUsers | null>(null);
    const [selectedDate, setSelectedDate] = useState("");
    const [activeTab, setActiveTab] = useState("overview");
    const [addEmployeeOpen, setAddEmployeeOpen] = useState(false);
    const [authChecked, setAuthChecked] = useState(false);
    const [accessDenied, setAccessDenied] = useState(false);

    const [relStartDate, setRelStartDate] = useState("");
    const [relEndDate, setRelEndDate] = useState("");

    const [showMassChangeDialog, setShowMassChangeDialog] = useState(false);
    const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
    const [massChangeSearchTerm, setMassChangeSearchTerm] = useState("");
    const [massChangeHourData, setMassChangeHourData] = useState<HourData>({
        clock_in: "",
        lunch_break_out: "",
        lunch_break_return: "",
        clocked_out: "",
        total_hours: "",
    });

    const today = getTodayKey();

    useEffect(() => {
        if (sessionStatus === "loading") return;

        if (sessionStatus === "guest") {
            void router.replace("/");
            return;
        }

        TauriApi.CanAccessAdmin().then((allowed) => {
            if (!allowed) {
                setAccessDenied(true);
                return;
            }
            setAuthChecked(true);
            TauriApi.GetSessionCapabilities()
                .then(setCapabilities)
                .catch(() => setCapabilities(null));
        });
    }, [sessionStatus, router]);

    const filteredEmployees = searchTerm
        ? users.filter(
              (e) =>
                  e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                  e.email?.toLowerCase().includes(searchTerm.toLowerCase())
          )
        : users;

    const filteredMassChangeEmployees = massChangeSearchTerm
        ? users.filter(
              (e) =>
                  e.name.toLowerCase().includes(massChangeSearchTerm.toLowerCase()) ||
                  e.email?.toLowerCase().includes(massChangeSearchTerm.toLowerCase())
          )
        : users;

    const stats = useMemo(() => {
        const total = users.length;
        const punchedToday = users.filter((u) => {
            const day = u.hour_data?.[today];
            return day && day.clock_in && day.clock_in !== "N/A";
        }).length;
        const completedToday = users.filter((u) => {
            const day = u.hour_data?.[today];
            return day && day.clocked_out && day.clocked_out !== "N/A";
        }).length;
        return {total, punchedToday, completedToday};
    }, [users, today]);

    const createReports = capabilities?.reportsCreate ?? false;

    function getUserData(employeeId: string) {
        const user = users.find((e) => e.id === employeeId);
        if (user) setSelectedEmployee(user);
    }

    const formatTimeWithSeconds = (time: string) => (time ? `${time}:00` : "N/A");

    async function handleMassChange() {
        const modifiedKeys = Object.keys(massChangeHourData).filter(
            (key) => massChangeHourData[key as keyof HourData] !== ""
        );

        if (modifiedKeys.length === 0) {
            toast.error("Nenhuma alteração", {
                description: "Informe ao menos um horário para atualizar.",
            });
            return;
        }

        const updatePromises = selectedEmployees.map(async (employeeId) => {
            const updatedHourData: Partial<HourData> = {};
            modifiedKeys.forEach((key) => {
                const val = massChangeHourData[key as keyof HourData];
                if (val) updatedHourData[key as keyof HourData] = formatTimeWithSeconds(val);
            });

            const fieldUpdates = Object.keys(updatedHourData).map(async (key) => {
                let keyToUpdate: Keys;
                switch (key) {
                    case "clock_in":
                        keyToUpdate = Keys.ClockIn;
                        break;
                    case "lunch_break_out":
                        keyToUpdate = Keys.ClockLunchOut;
                        break;
                    case "lunch_break_return":
                        keyToUpdate = Keys.ClockLunchReturn;
                        break;
                    case "clocked_out":
                        keyToUpdate = Keys.ClockOut;
                        break;
                    default:
                        return true;
                }
                const updatedValue = updatedHourData[key as keyof HourData];
                if (!updatedValue) return false;
                try {
                    return await TauriApi.UpdateUser(employeeId, today, keyToUpdate, updatedValue);
                } catch {
                    return false;
                }
            });

            const results = await Promise.all(fieldUpdates);
            return results.every(Boolean);
        });

        const updateResults = await Promise.all(updatePromises);

        if (updateResults.every(Boolean)) {
            await refreshUsers();
            toast.success("Atualização concluída", {
                description: "Horários atualizados para os funcionários selecionados.",
            });
        } else {
            toast.error("Erro parcial", {
                description: "Alguns registros não puderam ser atualizados.",
            });
        }
        setShowMassChangeDialog(false);
    }

    function toggleAllEmployees(checked: boolean) {
        setSelectedEmployees(checked ? filteredMassChangeEmployees.map((e) => e.id) : []);
    }

    async function handleGenerateReport() {
        if (!relStartDate || !relEndDate) return;
        const startDate = new Date(relStartDate).toLocaleDateString("pt-BR");
        const endDate = new Date(relEndDate).toLocaleDateString("pt-BR");

        try {
            await TauriApi.CreateReport(
                startDate,
                endDate,
                workHours.entry,
                workHours.exit,
                String(workHours.toleranceMinutes)
            );
            toast.success("Relatório gerado", {
                description: "Escolha onde salvar o arquivo Excel.",
            });
        } catch (e: any) {
            toast.error("Erro ao gerar relatório", {description: e?.message ?? String(e)});
        }
    }

    if (sessionStatus === "loading" || (!authChecked && !accessDenied)) {
        return (
            <div className="flex min-h-[50vh] items-center justify-center text-muted-foreground">
                Verificando permissões…
            </div>
        );
    }

    if (accessDenied) {
        return (
            <div className="mx-auto max-w-lg px-4 py-16 text-center space-y-4">
                <h1 className="text-xl font-semibold">Acesso restrito</h1>
                <p className="text-muted-foreground text-sm">
                    Sua conta não tem permissão de supervisão. Entre com um usuário administrador ou
                    supervisor para acessar esta área.
                </p>
                <Button asChild variant="secondary">
                    <Link href="/">Voltar ao ponto</Link>
                </Button>
            </div>
        );
    }

    return (
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 space-y-8">
            <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5 text-muted-foreground" asChild>
                <Link href="/">
                    <ArrowLeft className="h-4 w-4"/>
                    Voltar ao ponto
                </Link>
            </Button>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="space-y-2">
                    <p className="text-sm font-medium text-primary">Administração</p>
                    <h1 className="text-3xl font-bold tracking-tight">Central de gestão</h1>
                    <p className="text-muted-foreground max-w-2xl">
                        Visão operacional do dia, ajustes de ponto, equipe e contas de acesso — tudo
                        em um só lugar.
                    </p>
                </div>
                {users.length > 0 && (
                    <AddEmployeeTrigger onClick={() => setAddEmployeeOpen(true)}/>
                )}
            </div>

            <AddEmployee
                setUsers={setUsers}
                open={addEmployeeOpen}
                onOpenChange={setAddEmployeeOpen}
                defaultLunchTime="12:00"
            />

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard
                    label="Funcionários"
                    value={stats.total}
                    hint="Cadastrados no sistema"
                />
                <StatCard
                    label="Pontos hoje"
                    value={stats.punchedToday}
                    hint={`De ${stats.total} registraram entrada`}
                />
                <StatCard
                    label="Jornada concluída"
                    value={stats.completedToday}
                    hint="Saída registrada hoje"
                />
                <StatCard
                    label="Jornada configurada"
                    value={`${workHours.entry.slice(0, 5)} – ${workHours.exit.slice(0, 5)}`}
                    hint={`Tolerância: ${workHours.toleranceMinutes} min`}
                />
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="flex flex-wrap h-auto gap-1">
                    <TabsTrigger value="overview" className="gap-1.5">
                        <BarChart3 className="h-4 w-4"/> Visão geral
                    </TabsTrigger>
                    <TabsTrigger value="punches" className="gap-1.5">
                        <Users className="h-4 w-4"/> Pontos
                    </TabsTrigger>
                    <TabsTrigger value="accounts" className="gap-1.5">
                        <KeyRound className="h-4 w-4"/> Logins
                    </TabsTrigger>
                    <TabsTrigger value="reports" className="gap-1.5">
                        <FileText className="h-4 w-4"/> Relatórios
                    </TabsTrigger>
                    {capabilities?.hierarchyManage && (
                        <TabsTrigger value="audit" className="gap-1.5">
                            <ScrollText className="h-4 w-4"/> Auditoria
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="bulk" className="gap-1.5">
                        <Layers className="h-4 w-4"/> Em massa
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="mt-6 space-y-4">
                    {users.length === 0 && (
                        <Empty className="border">
                            <EmptyHeader>
                                <EmptyMedia variant="icon">
                                    <UserPlus/>
                                </EmptyMedia>
                                <EmptyTitle>Comece cadastrando sua equipe</EmptyTitle>
                                <EmptyDescription>
                                    Um funcionário no sistema já libera ponto, relatórios e gestão do
                                    dia. O cartão NFC e detalhes extras vêm depois.
                                </EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                                <AddEmployeeTrigger
                                    label="Cadastrar primeiro funcionário"
                                    onClick={() => setAddEmployeeOpen(true)}
                                />
                            </EmptyContent>
                        </Empty>
                    )}
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Ações rápidas</CardTitle>
                                <CardDescription>Atalhos para tarefas frequentes</CardDescription>
                            </CardHeader>
                            <CardContent className="flex flex-wrap gap-2">
                                <Button variant="secondary" size="sm" onClick={() => setActiveTab("punches")}>
                                    Revisar pontos de hoje
                                </Button>
                                <Button variant="secondary" size="sm" onClick={() => setActiveTab("accounts")}>
                                    Ver logins ativos
                                </Button>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={!createReports}
                                    onClick={() => setActiveTab("reports")}
                                >
                                    Gerar relatório
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => void refreshUsers()}>
                                    Atualizar dados
                                </Button>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Resumo de hoje</CardTitle>
                                <CardDescription>{today}</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-2 max-h-48 overflow-y-auto">
                                {users.length === 0 && (
                                    <p className="text-sm text-muted-foreground">
                                        Nenhum ponto registrado ainda — cadastre a equipe para começar.
                                    </p>
                                )}
                                {users.slice(0, 8).map((emp) => {
                                    const day = emp.hour_data?.[today];
                                    const status = !day?.clock_in || day.clock_in === "N/A"
                                        ? "Ausente"
                                        : !day?.clocked_out || day.clocked_out === "N/A"
                                          ? "Em jornada"
                                          : "Concluído";
                                    return (
                                        <div key={emp.id} className="flex items-center justify-between text-sm">
                                            <span>{emp.name}</span>
                                            <Badge variant="outline">{status}</Badge>
                                        </div>
                                    );
                                })}
                                {users.length > 8 && (
                                    <p className="text-xs text-muted-foreground pt-1">
                                        +{users.length - 8} funcionários — veja na aba Pontos
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <UserPlus className="h-4 w-4"/> Configuração operacional
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-muted-foreground space-y-2">
                            <p>
                                Horários e tolerância vêm de{" "}
                                <Button variant="link" className="h-auto p-0" onClick={() => router.push("/settings?tab=schedule")}>
                                    Configurações → Jornada
                                </Button>
                                . Relatórios Excel usam esses valores automaticamente.
                            </p>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="punches" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Pontos dos funcionários</CardTitle>
                            <CardDescription>Consulte e edite registros por data</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                                <Input
                                    placeholder="Buscar por nome ou e-mail"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="pl-10"
                                />
                            </div>
                            <Employees
                                selectedEmployee={selectedEmployee}
                                filteredEmployees={filteredEmployees}
                                selectedDate={selectedDate}
                                setSelectedDate={setSelectedDate}
                                setUsers={setUsers}
                                GetData={getUserData}
                                setSelectedEmployee={setSelectedEmployee}
                                capabilities={capabilities}
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="accounts" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Logins de acesso</CardTitle>
                            <CardDescription>
                                Gerencie senhas, perfis e status de contas já existentes. Novos
                                cadastros são feitos em um único fluxo ao adicionar funcionário.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <AccessAccounts employees={users}/>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="reports" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Relatório Excel</CardTitle>
                            <CardDescription>
                                Exporta presença, atrasos e faltas com base na jornada configurada
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 max-w-md">
                            {!createReports && (
                                <p className="text-sm text-muted-foreground">
                                    Sua conta não possui permissão para gerar relatórios.
                                </p>
                            )}
                            <div className="space-y-2">
                                <Label htmlFor="startDate">Data de início</Label>
                                <Input
                                    id="startDate"
                                    type="date"
                                    value={relStartDate}
                                    onChange={(e) => setRelStartDate(e.target.value)}
                                    disabled={!createReports}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="endDate">Data final</Label>
                                <Input
                                    id="endDate"
                                    type="date"
                                    value={relEndDate}
                                    onChange={(e) => setRelEndDate(e.target.value)}
                                    disabled={!createReports}
                                />
                            </div>
                            <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                                <p>Entrada: {workHours.entry.slice(0, 5)}</p>
                                <p>Saída: {workHours.exit.slice(0, 5)}</p>
                                <p>Tolerância: {workHours.toleranceMinutes} min</p>
                            </div>
                            <Button
                                disabled={!createReports || !relStartDate || !relEndDate}
                                onClick={() => void handleGenerateReport()}
                            >
                                Gerar e salvar Excel
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>

                {capabilities?.hierarchyManage && (
                    <TabsContent value="audit" className="mt-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Auditoria de acessos</CardTitle>
                                <CardDescription>
                                    Registro imutável de logins, contas e ações administrativas
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <AuditLog/>
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}

                <TabsContent value="bulk" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Mudança em massa</CardTitle>
                            <CardDescription>
                                Aplique os mesmos horários a vários funcionários para {today}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Button onClick={() => setShowMassChangeDialog(true)}>
                                Selecionar funcionários
                            </Button>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            <Dialog open={showMassChangeDialog} onOpenChange={setShowMassChangeDialog}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Mudança em massa — {today}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
                            <Input
                                placeholder="Buscar funcionários"
                                value={massChangeSearchTerm}
                                onChange={(e) => setMassChangeSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div className="max-h-[280px] overflow-y-auto border rounded-md">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="w-[50px]">
                                            <Checkbox
                                                checked={
                                                    filteredMassChangeEmployees.length > 0 &&
                                                    selectedEmployees.length ===
                                                        filteredMassChangeEmployees.length
                                                }
                                                onCheckedChange={toggleAllEmployees}
                                            />
                                        </TableHead>
                                        <TableHead>Nome</TableHead>
                                        <TableHead>Entrada</TableHead>
                                        <TableHead>Saída</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filteredMassChangeEmployees
                                        .sort((a, b) => a.name.localeCompare(b.name))
                                        .map((employee) => (
                                            <TableRow key={employee.id}>
                                                <TableCell>
                                                    <Checkbox
                                                        checked={selectedEmployees.includes(employee.id)}
                                                        onCheckedChange={(checked) => {
                                                            setSelectedEmployees((prev) =>
                                                                checked
                                                                    ? [...prev, employee.id]
                                                                    : prev.filter((id) => id !== employee.id)
                                                            );
                                                        }}
                                                    />
                                                </TableCell>
                                                <TableCell>{employee.name}</TableCell>
                                                <TableCell>
                                                    {employee.hour_data[today]?.clock_in || "N/A"}
                                                </TableCell>
                                                <TableCell>
                                                    {employee.hour_data[today]?.clocked_out || "N/A"}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                </TableBody>
                            </Table>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {(
                                [
                                    ["massClockIn", "clock_in", "Entrada"],
                                    ["massLunchOut", "lunch_break_out", "Saída almoço"],
                                    ["massLunchReturn", "lunch_break_return", "Retorno almoço"],
                                    ["massClockOut", "clocked_out", "Saída"],
                                ] as const
                            ).map(([id, key, label]) => (
                                <div key={id} className="space-y-2">
                                    <Label htmlFor={id}>{label}</Label>
                                    <Input
                                        id={id}
                                        type="time"
                                        value={massChangeHourData[key]}
                                        onChange={(e) =>
                                            setMassChangeHourData((prev) => ({
                                                ...prev,
                                                [key]: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                        <Button
                            onClick={() => void handleMassChange()}
                            disabled={selectedEmployees.length === 0}
                        >
                            Aplicar a {selectedEmployees.length} funcionário(s)
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
}
