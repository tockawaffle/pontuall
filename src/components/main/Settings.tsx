import Link from "next/link";
import {useRouter} from "next/router";
import {
    ArrowLeft,
    CheckCircle2,
    Circle,
    CreditCard,
    Monitor,
    Palette,
    Shield,
    User,
    Wifi,
} from "lucide-react";
import React, {useEffect, useMemo, useState} from "react";
import {allTimezones, useTimezoneSelect} from "react-timezone-select";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import {Badge} from "@/components/ui/badge";
import {Progress} from "@/components/ui/progress";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {SpinnerIcon} from "@/components/component/icons";
import TauriApi from "@/lib/Tauri";
import {ACCESS_LEVEL_LABELS, normalizeAccessLevel} from "@/lib/pontuall-permissions";
import {useApp, type ThemeId} from "@/contexts/app-context";
import {cn} from "@/lib/utils";
import {toast} from "sonner";

const labelStyle = "original";
const timezones = {...allTimezones};

function SetupChecklistItem({
    done,
    label,
    hint,
}: {
    done: boolean;
    label: string;
    hint: string;
}) {
    return (
        <div className="flex items-start gap-3 rounded-lg border p-3">
            {done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success"/>
            ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"/>
            )}
            <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const router = useRouter();
    const tabFromQuery = typeof router.query.tab === "string" ? router.query.tab : "appearance";
    const [activeTab, setActiveTab] = useState(tabFromQuery);

    const {
        theme,
        setTheme,
        hourFormat,
        setHourFormat,
        dateFormat,
        setDateFormat,
        timezone,
        setTimezone,
        workHours,
        readerConnected,
        userLogged,
        version,
        clock,
    } = useApp();

    const {options, parseTimezone} = useTimezoneSelect({labelStyle, timezones});

    const [cardDiag, setCardDiag] = useState<{
        uid: string;
        magic_ok: boolean;
        authenticated: boolean;
    } | null>(null);
    const [cardDataError, setCardDataError] = useState("");
    const [readerName, setReaderName] = useState("");
    const [diagOpen, setDiagOpen] = useState(false);

    const [passwordChange, setPasswordChange] = useState({current: "", next: ""});
    const [passwordSaving, setPasswordSaving] = useState(false);

    const isLoggedIn = Object.keys(userLogged).length > 0;
    const loggedUser = isLoggedIn ? (userLogged as UserLogged) : null;

    useEffect(() => {
        if (router.isReady && typeof router.query.tab === "string") {
            setActiveTab(router.query.tab);
        }
    }, [router.isReady, router.query.tab]);

    const setupScore = useMemo(() => {
        let score = 0;
        if (theme) score += 20;
        if (workHours.entry) score += 25;
        if (readerConnected) score += 25;
        if (isLoggedIn) score += 15;
        if (timezone) score += 15;
        return score;
    }, [readerConnected, isLoggedIn, theme, workHours.entry, timezone]);

    const checklist = useMemo(
        () => [
            {
                done: Boolean(workHours.entry),
                label: "Horários da jornada",
                hint: "Entrada, saída e tolerância para validar pontos",
            },
            {
                done: readerConnected === true,
                label: "Leitor NFC conectado",
                hint: "Necessário para registrar batidas com cartão",
            },
            {
                done: isLoggedIn,
                label: "Conta de acesso ativa",
                hint: "Login para funções de supervisor e relatórios",
            },
            {
                done: Boolean(theme),
                label: "Aparência personalizada",
                hint: "Tema e formato de hora do relógio",
            },
        ],
        [readerConnected, isLoggedIn, workHours.entry, theme]
    );

    async function handleDiagnostic() {
        setCardDiag(null);
        setCardDataError("");
        try {
            setCardDiag(await TauriApi.CardDiagnostic());
        } catch (e: any) {
            setCardDataError(e?.message ?? "Erro ao ler o cartão.");
        }
    }

    async function handleCloseRead() {
        setCardDiag(null);
        try {
            await TauriApi.CancelCard();
        } catch {
            /* ignore */
        }
    }

    async function handleReaderTest() {
        try {
            const status = await TauriApi.ReaderStatus();
            setReaderName(status.connected && status.name ? status.name : "");
        } catch {
            setReaderName("");
        }
    }

    async function handleChangePassword() {
        if (!passwordChange.current || passwordChange.next.length < 10) return;
        setPasswordSaving(true);
        try {
            await TauriApi.ChangePassword(passwordChange.current, passwordChange.next);
            setPasswordChange({current: "", next: ""});
            toast.success("Senha alterada com sucesso");
        } catch (e: any) {
            toast.error("Não foi possível alterar a senha", {
                description: e?.message ?? String(e),
            });
        } finally {
            setPasswordSaving(false);
        }
    }

    return (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-8">
            <Button variant="ghost" size="sm" className="-ml-2 w-fit gap-1.5 text-muted-foreground" asChild>
                <Link href="/">
                    <ArrowLeft className="h-4 w-4"/>
                    Voltar ao ponto
                </Link>
            </Button>

            <div className="space-y-2">
                <p className="text-sm font-medium text-primary">Configurações</p>
                <h1 className="text-3xl font-bold tracking-tight">Seu ambiente de ponto</h1>
                <p className="text-muted-foreground max-w-2xl">
                    Ajuste aparência, jornada e leitor. Quanto mais completo o setup, menos surpresas na hora
                    de bater ponto e gerar relatórios.
                </p>
            </div>

            <Card className="border-primary/20 bg-linear-to-br from-primary/5 to-transparent">
                <CardHeader className="pb-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                            <CardTitle className="text-lg">Prontidão do sistema</CardTitle>
                            <CardDescription>
                                {setupScore >= 80
                                    ? "Tudo pronto para operação diária."
                                    : "Complete os itens abaixo para reduzir erros operacionais."}
                            </CardDescription>
                        </div>
                        <Badge variant={setupScore >= 80 ? "default" : "secondary"} className="w-fit">
                            {setupScore}% configurado
                        </Badge>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Progress value={setupScore}/>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {checklist.map((item) => (
                            <SetupChecklistItem key={item.label} {...item} />
                        ))}
                    </div>
                </CardContent>
            </Card>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="flex flex-wrap h-auto gap-1">
                    <TabsTrigger value="appearance" className="gap-1.5">
                        <Palette className="h-4 w-4"/> Aparência
                    </TabsTrigger>
                    <TabsTrigger value="reader" className="gap-1.5">
                        <CreditCard className="h-4 w-4"/> Leitor NFC
                    </TabsTrigger>
                    <TabsTrigger value="account" className="gap-1.5">
                        <User className="h-4 w-4"/> Conta
                    </TabsTrigger>
                    <TabsTrigger value="system" className="gap-1.5">
                        <Monitor className="h-4 w-4"/> Sistema
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="appearance" className="mt-6 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Aparência e relógio</CardTitle>
                            <CardDescription>
                                O relógio do cabeçalho reflete estas preferências imediatamente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Tema</Label>
                                <Select value={theme} onValueChange={(v) => setTheme(v as ThemeId)}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="midnight">Meia-Noite</SelectItem>
                                        <SelectItem value="deepsea">Mar Profundo</SelectItem>
                                        <SelectItem value="pastel">Pastel</SelectItem>
                                        <SelectItem value="daylight">Claro</SelectItem>
                                        <SelectItem value="sunset">Pôr do Sol</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Pré-visualização</Label>
                                <div className="flex h-10 items-center rounded-md border px-3 text-sm font-medium">
                                    {clock || "—"}
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Formato 12h / 24h</Label>
                                <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as "12" | "24")}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="24">24 horas</SelectItem>
                                        <SelectItem value="12">12 horas (AM/PM)</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Segundos no relógio</Label>
                                <Select value={hourFormat} onValueChange={(v) => setHourFormat(v as "HH:MM" | "HH:MM:SS")}>
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="HH:MM">HH:MM</SelectItem>
                                        <SelectItem value="HH:MM:SS">HH:MM:SS</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2 sm:col-span-2">
                                <Label>Fuso horário</Label>
                                <Select
                                    value={timezone}
                                    onValueChange={(v) => setTimezone(parseTimezone(v).value)}
                                >
                                    <SelectTrigger><SelectValue/></SelectTrigger>
                                    <SelectContent className="max-h-60">
                                        {options.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>
                                                {option.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="reader" className="mt-6 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Leitor NFC</CardTitle>
                            <CardDescription>
                                Status em tempo real do leitor ACR122U conectado ao posto de ponto.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div
                                className={cn(
                                    "flex items-center gap-3 rounded-lg border p-4",
                                    readerConnected ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
                                )}
                            >
                                <Wifi className={cn("h-5 w-5", readerConnected ? "text-success" : "text-warning")}/>
                                <div>
                                    <p className="font-medium">
                                        {readerConnected ? "Leitor conectado" : "Leitor não detectado"}
                                    </p>
                                    <p className="text-sm text-muted-foreground">
                                        {readerConnected
                                            ? "Pronto para ler cartões PontuAll."
                                            : "Verifique USB, drivers e serviço Smart Card do Windows."}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button variant="secondary" onClick={() => void handleReaderTest()}>
                                            Testar conexão
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Teste de conectividade</DialogTitle>
                                            <DialogDescription>
                                                {readerName
                                                    ? <>Conectado ao leitor <strong>{readerName}</strong>.</>
                                                    : "Não foi possível conectar ao leitor."}
                                            </DialogDescription>
                                        </DialogHeader>
                                    </DialogContent>
                                </Dialog>
                                <Dialog
                                    open={diagOpen}
                                    onOpenChange={(open) => {
                                        setDiagOpen(open);
                                        if (!open) {
                                            void handleCloseRead();
                                            setCardDiag(null);
                                            setCardDataError("");
                                        }
                                    }}
                                >
                                    <DialogTrigger asChild>
                                        <Button variant="outline" onClick={() => void handleDiagnostic()}>
                                            Diagnosticar cartão
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>Diagnóstico do cartão</DialogTitle>
                                            <DialogDescription>
                                                {!cardDiag && !cardDataError
                                                    ? "Aproxime o cartão do leitor."
                                                    : "Leitura concluída."}
                                            </DialogDescription>
                                        </DialogHeader>
                                        {!cardDiag && !cardDataError && (
                                            <div className="flex justify-center py-8">
                                                <SpinnerIcon className="h-16 w-16 animate-spin"/>
                                            </div>
                                        )}
                                        {cardDiag && (
                                            <div className="space-y-1 text-sm">
                                                <p>UID: <strong>{cardDiag.uid}</strong></p>
                                                <p>Formato PontuAll: <strong>{cardDiag.magic_ok ? "Sim" : "Não"}</strong></p>
                                                <p>Autenticação: <strong>{cardDiag.authenticated ? "OK" : "Falhou"}</strong></p>
                                            </div>
                                        )}
                                        {cardDataError && (
                                            <p className="text-sm text-destructive">{cardDataError}</p>
                                        )}
                                        <DialogFooter>
                                            <DialogClose asChild>
                                                <Button variant="outline">Fechar</Button>
                                            </DialogClose>
                                        </DialogFooter>
                                    </DialogContent>
                                </Dialog>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="account" className="mt-6 space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Sua conta</CardTitle>
                            <CardDescription>
                                Credenciais Better Auth vinculadas ao seu cadastro de funcionário.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {loggedUser ? (
                                <>
                                    <div className="flex items-center gap-3 rounded-lg border p-4">
                                        <Shield className="h-5 w-5 text-primary"/>
                                        <div>
                                            <p className="font-medium">{loggedUser.name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                Cargo: {loggedUser.role} · Perfil:{" "}
                                                {ACCESS_LEVEL_LABELS[normalizeAccessLevel(loggedUser.accessRole)]}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-2">
                                            <Label htmlFor="current-pw">Senha atual</Label>
                                            <Input
                                                id="current-pw"
                                                type="password"
                                                value={passwordChange.current}
                                                onChange={(e) =>
                                                    setPasswordChange((p) => ({...p, current: e.target.value}))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="new-pw">Nova senha (mín. 10)</Label>
                                            <Input
                                                id="new-pw"
                                                type="password"
                                                value={passwordChange.next}
                                                onChange={(e) =>
                                                    setPasswordChange((p) => ({...p, next: e.target.value}))
                                                }
                                            />
                                        </div>
                                    </div>
                                    <Button
                                        onClick={() => void handleChangePassword()}
                                        disabled={
                                            passwordSaving ||
                                            !passwordChange.current ||
                                            passwordChange.next.length < 10
                                        }
                                    >
                                        {passwordSaving ? "Salvando…" : "Alterar senha"}
                                    </Button>
                                </>
                            ) : (
                                <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
                                    <p className="text-sm text-muted-foreground">
                                        Faça login pelo menu superior para alterar senha e acessar funções de supervisor.
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Use o botão <strong>Login</strong> no canto superior direito.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="system" className="mt-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Sistema</CardTitle>
                            <CardDescription>Informações da instalação local PontuAll.</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-muted-foreground">Versão</span>
                                <span className="font-medium">{version.version || "—"}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-muted-foreground">Codinome</span>
                                <span className="font-medium">{version.versionName || "—"}</span>
                            </div>
                            <div className="flex justify-between border-b pb-2">
                                <span className="text-muted-foreground">Leitor NFC</span>
                                <span className="font-medium">
                                    {readerConnected === null ? "…" : readerConnected ? "Conectado" : "Offline"}
                                </span>
                            </div>
                            <div className="pt-2 flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" asChild>
                                    <Link href="/">Voltar ao ponto</Link>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
}
