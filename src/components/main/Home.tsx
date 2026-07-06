import {Button, buttonVariants} from "@/components/ui/button";
import {type VariantProps} from "class-variance-authority";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Avatar, AvatarFallback} from "@/components/ui/avatar";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "@/components/ui/dialog";
import {
    AlertLoop,
    ChevronRightIcon,
    ClockIcon,
    ConfirmCircle,
    ErrorCircle,
    InfoAlert,
} from "@/components/component/icons";
import React, {useEffect, useState} from "react";
import {useRouter} from "next/router";
import TauriApi from "@/lib/Tauri";
import {useApp} from "@/contexts/app-context";
import {Separator} from "@/components/ui/separator";
import {Badge} from "@/components/ui/badge";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import {
    countByStatus,
    formatTodayDate,
    getPunchStatus,
    getTimeGreeting,
    getTodayKey,
    PUNCH_STATUS_LABEL,
    type PunchStatus,
} from "@/lib/home-display";
import {HandleClockIn, HandleCloseRead, HandleGetUser} from "@/components/main/helpers/home";

const STATUS_BADGE_VARIANT: Record<PunchStatus, "default" | "secondary" | "outline" | "destructive"> = {
    absent: "outline",
    working: "default",
    lunch: "secondary",
    done: "secondary",
};

export default function HomePage() {
    const router = useRouter();
    const {users, setUsers, clock, timezone, userLogged, sessionStatus} = useApp();

    const [openPunchDialog, setOpenPunchDialog] = useState<boolean>(false);
    const [noCardDialog, setNoCardDialog] = useState<boolean>(false);
    const [noCardStep, setNoCardStep] = useState<"email" | "otp">("email");
    const [noCardEmail, setNoCardEmail] = useState("");
    const [noCardOtp, setNoCardOtp] = useState("");
    const [noCardLoading, setNoCardLoading] = useState(false);
    const [noCardError, setNoCardError] = useState("");
    const [manualPunchAvailable, setManualPunchAvailable] = useState(false);

    const [messageDialogOpen, setMessageDialogOpen] = useState<boolean>(false);
    const [dialogMessage, setDialogMessage] = useState<{
        message: string,
        subMessage?: string[],
        type: string,
        showDefaultCancel?: boolean
        release?: string
    }>({message: "", type: ""});

    const [clockUser, setClockUser] = useState<IUsers | null>(null);
    const [activePunchSource, setActivePunchSource] = useState<"card" | "manual_otp">("card");


    const [hasPermissions, setHasPermissions] = useState<boolean>(false);

    const today = getTodayKey();
    const greeting = getTimeGreeting(new Date().getHours());
    const dateLabel = formatTodayDate(timezone);
    const statusCounts = countByStatus(users, today);
    const employeesWithPunches = users.filter((user) => getPunchStatus(user.hour_data?.[today]) !== "absent");
    const sortedUsers = [...users].sort((a, b) => a.name.localeCompare(b.name));

    useEffect(() => {
        TauriApi.GetManualPunchStatus()
            .then((status) => setManualPunchAvailable(status.available))
            .catch(() => setManualPunchAvailable(false));
    }, []);

    useEffect(() => {
        if (sessionStatus !== "authenticated" || !userLogged || Object.keys(userLogged).length === 0) {
            setHasPermissions(false);
            return;
        }

        TauriApi.SessionHasPermission({punch: ["read-others"]})
            .then(setHasPermissions)
            .catch(() => setHasPermissions(false));
    }, [userLogged, sessionStatus]);

    function resetNoCardFlow() {
        setNoCardStep("email");
        setNoCardEmail("");
        setNoCardOtp("");
        setNoCardError("");
        setNoCardLoading(false);
    }

    async function openNoCardFlow() {
        await HandleCloseRead(setClockUser);
        setOpenPunchDialog(false);
        resetNoCardFlow();
        setNoCardDialog(true);
    }

    async function handleRequestOtp() {
        const email = noCardEmail.trim().toLowerCase();
        if (!email.includes("@")) {
            setNoCardError("Informe o e-mail cadastrado na sua conta.");
            return;
        }

        setNoCardLoading(true);
        setNoCardError("");
        try {
            await TauriApi.RequestPunchOtp(email);
            setNoCardEmail(email);
            setNoCardStep("otp");
            setNoCardOtp("");
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setNoCardError(message || "Não foi possível enviar o código.");
        } finally {
            setNoCardLoading(false);
        }
    }

    async function handleVerifyOtp() {
        const email = noCardEmail.trim().toLowerCase();
        const code = noCardOtp.trim();
        if (code.length !== 6) {
            setNoCardError("Informe o código de 6 dígitos.");
            return;
        }

        setNoCardLoading(true);
        setNoCardError("");
        try {
            const employeeId = await TauriApi.VerifyPunchOtp(email, code);
            const user = users.find((u) => u.id === employeeId);
            if (!user) {
                throw new Error("Funcionário não encontrado após verificação.");
            }
            setClockUser(user);
            setActivePunchSource("manual_otp");
            setNoCardDialog(false);
            resetNoCardFlow();
            await HandleClockIn(
                user,
                setMessageDialogOpen,
                setDialogMessage,
                users,
                setUsers,
                undefined,
                "manual_otp",
            );
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            setNoCardError(message || "Código inválido.");
        } finally {
            setNoCardLoading(false);
        }
    }

    return (
        <>
            <Dialog
                open={messageDialogOpen}
                onOpenChange={(open) => {
                    setMessageDialogOpen(open);
                    if (!open) {
                        setDialogMessage({message: "", type: ""});
                    }
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <div className={"flex justify-start items-center space-x-2 select-none"}>
                            <ClockIcon className="w-6 h-6 text-primary"/>
                            <p>PontuAll</p>
                        </div>
                        <div className={"flex justify-center items-center mb-6"}>
                            {
                                dialogMessage.type === "success" ?
                                    <ConfirmCircle color={"currentColor"} className="w-16 h-16 text-success"/> :
                                    dialogMessage.type === "destroy" ?
                                        <ErrorCircle color={"currentColor"} className="w-16 h-16 text-destructive"/> :
                                        dialogMessage.type === "warning" ?
                                            <AlertLoop color={"currentColor"} className="w-16 h-16 text-warning"/> :
                                            dialogMessage.type === "info" ?
                                                <InfoAlert color={"currentColor"} className="w-16 h-16 text-info"/> : ""
                            }
                        </div>
                        <DialogTitle className={"text-foreground text-center text-3xl"}>
                            {
                                dialogMessage.type === "success" ? "Sucesso!" :
                                    dialogMessage.type === "destroy" ? "Erro!" :
                                        dialogMessage.type === "warning" ? "Atenção!" :
                                            dialogMessage.type === "info" ? "Informação" : ""
                            }

                        </DialogTitle>
                        <DialogDescription className={"text-center text-foreground text-lg"}>
                            {dialogMessage.message}
                            <Separator className={"m-2"}/>
                            {
                                dialogMessage.subMessage && dialogMessage.subMessage.length > 0 && (
                                    dialogMessage.subMessage.map((message, index) => (
                                            <p key={index} className={"text-muted-foreground"}>
                                                {message}
                                            </p>
                                        )
                                    )
                                )
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        {
                            [
                                {
                                    name: "Confirmar",
                                    variant: "default",
                                    show: dialogMessage.type === "bypass-clock-out",
                                    release: dialogMessage.release ?? "",
                                    showDefaultCancel: dialogMessage.showDefaultCancel ?? false,
                                    onClick: () => {
                                        setDialogMessage({message: "", type: ""});
                                        setMessageDialogOpen(false);
                                        if (!clockUser) {
                                            console.error("No user to clock out.");
                                            return;
                                        }
                                        setOpenPunchDialog(false);
                                        HandleClockIn(
                                            clockUser,
                                            setMessageDialogOpen,
                                            setDialogMessage,
                                            users,
                                            setUsers,
                                            {type: "ClockOut"},
                                            activePunchSource,
                                        );
                                    }
                                },
                                {
                                    name: "Confirmar",
                                    variant: "default",
                                    show: dialogMessage.type === "bypass-clock-lunch-return",
                                    release: dialogMessage.release ?? "",
                                    showDefaultCancel: dialogMessage.showDefaultCancel ?? false,
                                    onClick: () => {
                                        setDialogMessage({message: "", type: ""});
                                        setMessageDialogOpen(false);
                                        if (!clockUser) {
                                            console.error("No user to clock out.");
                                            return;
                                        }
                                        setOpenPunchDialog(false);
                                        HandleClockIn(
                                            clockUser,
                                            setMessageDialogOpen,
                                            setDialogMessage,
                                            users,
                                            setUsers,
                                            {type: "ClockLunchReturn"},
                                            activePunchSource,
                                        );
                                    }
                                },
                                {
                                    name: "Fechar",
                                    variant: "destructive",
                                    show: dialogMessage.type === "destroy",
                                    release: dialogMessage.release ?? "",
                                    showDefaultCancel: false,
                                    onClick: () => {
                                        setOpenPunchDialog(false);
                                        setDialogMessage({message: "", type: ""});
                                        setMessageDialogOpen(false);
                                    }
                                },
                                {
                                    name: "Fechar",
                                    variant: "warning",
                                    show: dialogMessage.type === "warning",
                                    showDefaultCancel: false,
                                    release: dialogMessage.release ?? "",
                                    onClick: () => {
                                        setOpenPunchDialog(false);
                                        setDialogMessage({message: "", type: ""});
                                        setMessageDialogOpen(false);
                                    }
                                },
                                {
                                    name: "Fechar",
                                    variant: "default",
                                    show: dialogMessage.type === "info" || dialogMessage.type === "success",
                                    release: dialogMessage.release ?? "",
                                    showDefaultCancel: false,
                                    onClick: () => {
                                        setOpenPunchDialog(false);
                                        setDialogMessage({message: "", type: ""});
                                        setMessageDialogOpen(false);
                                    }
                                }
                            ].map((button, index) => (
                                button.show && (
                                    <div key={index} className={"flex justify-between w-[50%]"}>
                                        {
                                            button.release !== "" && button.release === "clock_out" && (
                                                <Button
                                                    variant="destructive"
                                                    onClick={() => {
                                                        setOpenPunchDialog(false);
                                                        setDialogMessage({message: "", type: ""});
                                                        setMessageDialogOpen(false);
                                                        HandleClockIn(
                                                            clockUser!,
                                                            setMessageDialogOpen,
                                                            setDialogMessage,
                                                            users,
                                                            setUsers,
                                                            {type: "ClockOut"},
                                                            activePunchSource,
                                                        );
                                                    }}
                                                >
                                                    Ponto de Saída
                                                </Button>
                                            )
                                        }
                                        <Button
                                            key={index}
                                            variant={button.variant as NonNullable<VariantProps<typeof buttonVariants>["variant"]>}
                                            onClick={button.onClick}
                                        >
                                            {button.name}
                                        </Button>
                                        {
                                            button.showDefaultCancel && (
                                                <Button
                                                    variant="destructive"
                                                    onClick={() => {
                                                        setOpenPunchDialog(false);
                                                        setDialogMessage({message: "", type: ""});
                                                        setMessageDialogOpen(false);
                                                    }}
                                                >
                                                    Cancelar
                                                </Button>
                                            )
                                        }
                                    </div>
                                )
                            ))
                        }
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <Dialog
                open={noCardDialog}
                onOpenChange={(open) => {
                    setNoCardDialog(open);
                    if (!open) resetNoCardFlow();
                }}
            >
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {noCardStep === "email" ? "Ponto sem cartão" : "Digite o código"}
                        </DialogTitle>
                        <DialogDescription>
                            {noCardStep === "email"
                                ? "Informe o e-mail da sua conta. Enviaremos um código de uso único válido por 5 minutos."
                                : `Enviamos um código de 6 dígitos para ${noCardEmail}.`}
                        </DialogDescription>
                    </DialogHeader>
                    {noCardStep === "email" ? (
                        <div className="grid gap-3">
                            <div>
                                <Label htmlFor="no-card-email">E-mail</Label>
                                <Input
                                    id="no-card-email"
                                    type="email"
                                    autoComplete="email"
                                    placeholder="seu@email.com"
                                    value={noCardEmail}
                                    disabled={noCardLoading}
                                    onChange={(e) => setNoCardEmail(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleRequestOtp();
                                    }}
                                />
                            </div>
                            {noCardError && (
                                <p className="text-sm text-destructive">{noCardError}</p>
                            )}
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            <div>
                                <Label htmlFor="no-card-otp">Código</Label>
                                <Input
                                    id="no-card-otp"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={noCardOtp}
                                    disabled={noCardLoading}
                                    onChange={(e) =>
                                        setNoCardOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleVerifyOtp();
                                    }}
                                />
                            </div>
                            {noCardError && (
                                <p className="text-sm text-destructive">{noCardError}</p>
                            )}
                        </div>
                    )}
                    <DialogFooter className="gap-2 sm:justify-between">
                        {noCardStep === "otp" ? (
                            <Button
                                variant="outline"
                                disabled={noCardLoading}
                                onClick={() => {
                                    setNoCardStep("email");
                                    setNoCardOtp("");
                                    setNoCardError("");
                                }}
                            >
                                Voltar
                            </Button>
                        ) : (
                            <span />
                        )}
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                disabled={noCardLoading}
                                onClick={() => setNoCardDialog(false)}
                            >
                                Cancelar
                            </Button>
                            {noCardStep === "email" ? (
                                <Button
                                    disabled={noCardLoading || !noCardEmail.trim().includes("@")}
                                    onClick={() => void handleRequestOtp()}
                                >
                                    {noCardLoading ? "Enviando…" : "Enviar código"}
                                </Button>
                            ) : (
                                <Button
                                    disabled={noCardLoading || noCardOtp.length !== 6}
                                    onClick={() => void handleVerifyOtp()}
                                >
                                    {noCardLoading ? "Verificando…" : "Bater ponto"}
                                </Button>
                            )}
                        </div>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            <main className="flex-1 flex flex-col items-center justify-center gap-6 p-4 md:p-8">
                <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/15 bg-linear-to-b from-card to-card/60 p-8 shadow-lg">
                    <div className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-primary/15 blur-2xl"/>
                    <div className="relative flex flex-col items-center gap-2 text-center">
                        <p className="text-sm font-medium capitalize text-muted-foreground">{dateLabel}</p>
                        <p className="text-lg text-muted-foreground">{greeting}</p>
                        <div className="font-heading text-6xl font-bold tabular-nums tracking-tight md:text-7xl">
                            <span className="text-primary">{clock}</span>
                        </div>
                    </div>
                    <div className="relative mt-8 flex flex-col items-center gap-3">
                        <Dialog
                            open={openPunchDialog}
                            onOpenChange={(open) => {
                                setOpenPunchDialog(open);
                                if (!open) {
                                    HandleCloseRead(setClockUser);
                                }
                            }}
                        >
                            <DialogTrigger asChild>
                                <Button
                                    size="lg"
                                    className="h-14 min-w-[220px] gap-2 text-base font-semibold shadow-lg shadow-primary/30 transition-transform hover:scale-[1.02] active:scale-[0.98]"
                                    onClick={() => {
                                        HandleGetUser(
                                            setOpenPunchDialog,
                                            users,
                                            setClockUser,
                                            setMessageDialogOpen,
                                            setDialogMessage,
                                            setUsers,
                                        );
                                        setActivePunchSource("card");
                                    }}
                                >
                                    <ClockIcon className="size-5"/>
                                    Bater Ponto
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="text-center">
                                        Aproxime o cartão do leitor
                                    </DialogTitle>
                                    <DialogDescription className="text-center">
                                        Mantenha o cartão NFC sobre o leitor até ouvir a confirmação.
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="flex flex-col items-center justify-center gap-4 py-6">
                                    <div className="relative flex size-28 items-center justify-center">
                                        <div className="nfc-pulse-ring absolute inset-0 rounded-full border-2 border-primary/40"/>
                                        <div className="nfc-pulse-ring nfc-pulse-ring-delay absolute inset-2 rounded-full border-2 border-primary/25"/>
                                        <div className="relative flex size-20 items-center justify-center rounded-full bg-primary/10 ring-2 ring-primary/30">
                                            <ClockIcon className="size-10 text-primary"/>
                                        </div>
                                    </div>
                                    <p className="text-sm text-muted-foreground animate-pulse">
                                        Aguardando cartão…
                                    </p>
                                </div>
                                <DialogFooter className="flex-wrap gap-2 sm:justify-between">
                                    <DialogClose asChild>
                                        <Button
                                            onClick={() => {
                                                setOpenPunchDialog(false);
                                                HandleCloseRead(setClockUser);
                                            }}
                                            variant="destructive"
                                        >
                                            Cancelar
                                        </Button>
                                    </DialogClose>
                                    {manualPunchAvailable && (
                                        <Button variant="outline" onClick={() => void openNoCardFlow()}>
                                            Sem cartão?
                                        </Button>
                                    )}
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span tabIndex={0}>
                                                    <Button variant="outline" disabled className="pointer-events-none">
                                                        Código QR
                                                    </Button>
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent>Em breve</TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        <p className="text-xs text-muted-foreground">
                            Toque no botão e aproxime seu cartão NFC
                        </p>
                    </div>
                </div>

                {users.length > 0 && (
                    <div className="flex w-full max-w-md flex-wrap justify-center gap-2">
                        {statusCounts.working > 0 && (
                            <Badge variant="default">{statusCounts.working} presente{statusCounts.working !== 1 ? "s" : ""}</Badge>
                        )}
                        {statusCounts.lunch > 0 && (
                            <Badge variant="secondary">{statusCounts.lunch} no almoço</Badge>
                        )}
                        {statusCounts.done > 0 && (
                            <Badge variant="secondary">{statusCounts.done} concluído{statusCounts.done !== 1 ? "s" : ""}</Badge>
                        )}
                        {statusCounts.absent > 0 && (
                            <Badge variant="outline">{statusCounts.absent} ausente{statusCounts.absent !== 1 ? "s" : ""}</Badge>
                        )}
                    </div>
                )}

                <Card className="w-full max-w-md">
                    <CardHeader className="pb-3">
                        <CardTitle>Pontos do dia</CardTitle>
                        <CardDescription>
                            {employeesWithPunches.length > 0
                                ? `${employeesWithPunches.length} de ${users.length} funcionário${users.length !== 1 ? "s" : ""} registraram ponto hoje`
                                : "Nenhum registro ainda — seja o primeiro a bater ponto"}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid max-h-[280px] gap-1 overflow-y-auto custom-scrollbar">
                            {
                                users.length > 0 ? sortedUsers.map((user, index) => {
                                    const userData = user.hour_data?.[today];
                                    const status = getPunchStatus(userData);

                                    return (
                                        <div key={index} className="rounded-lg px-2 py-2 transition-colors hover:bg-muted/40">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex min-w-0 items-center gap-2">
                                                    <Avatar className="size-9 border">
                                                        <AvatarFallback className="text-sm">
                                                            {user.name.charAt(0).toUpperCase()}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <div className="truncate font-medium">
                                                            {user.name}
                                                        </div>
                                                        <div className="text-sm text-muted-foreground tabular-nums">
                                                            {userData?.clock_in ?? "—"}
                                                            {userData?.clocked_out ? ` → ${userData.clocked_out}` : ""}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-1">
                                                    <Badge variant={STATUS_BADGE_VARIANT[status]} className="hidden sm:inline-flex">
                                                        {PUNCH_STATUS_LABEL[status]}
                                                    </Badge>
                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="size-8">
                                                                <ChevronRightIcon className="size-4"/>
                                                            </Button>
                                                        </DialogTrigger>
                                                    <DialogContent className="max-w-md">
                                                        <DialogHeader>
                                                            <DialogTitle className={"flex flex-row items-center"}>
                                                                <ClockIcon className="w-6 h-6 mr-2"/>
                                                                <span>
                                                                Pontuall
                                                            </span>
                                                            </DialogTitle>
                                                            <DialogDescription>
                                                                Mais informações sobre o ponto registrado
                                                            </DialogDescription>
                                                        </DialogHeader>
                                                        <div>
                                                            <div className="grid gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <Avatar className="border">
                                                                        <AvatarFallback>
                                                                            {
                                                                                user.name.charAt(0).toUpperCase()
                                                                            }
                                                                        </AvatarFallback>
                                                                    </Avatar>
                                                                    <div>
                                                                        <div className="font-medium">
                                                                            {user.name}
                                                                        </div>
                                                                        <div
                                                                            className="text-sm text-muted-foreground">
                                                                            {user.role}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="grid gap-1">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="text-muted-foreground">
                                                                            Ponto de Entrada:
                                                                        </div>
                                                                        <div>
                                                                            {
                                                                                userData?.clock_in ?? "Não registrado"
                                                                            }
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="text-muted-foreground">
                                                                            Ponto de Saída:
                                                                        </div>
                                                                        <div>
                                                                            {
                                                                                userData?.clocked_out ?? "Não registrado"
                                                                            }
                                                                        </div>
                                                                    </div>
                                                                    {
                                                                        hasPermissions && (
                                                                            <>
                                                                                <div
                                                                                    className="border-t border-muted my-2"/>
                                                                                <div
                                                                                    className="flex items-center justify-between">
                                                                                    <div className="text-muted-foreground">
                                                                                        Total de Horas:
                                                                                    </div>
                                                                                    <div>
                                                                                        {
                                                                                            userData?.total_hours ?? "Não registrado"
                                                                                        }
                                                                                    </div>
                                                                                </div>
                                                                                <div
                                                                                    className="flex items-center justify-between">
                                                                                    <div className="text-muted-foreground">
                                                                                        Intervalo de Almoço (Saída):
                                                                                    </div>
                                                                                    <div>
                                                                                        {
                                                                                            userData?.lunch_break_out ?? "Não registrado"
                                                                                        }
                                                                                    </div>
                                                                                </div>
                                                                                <div
                                                                                    className="flex items-center justify-between">
                                                                                    <div
                                                                                        className="text-muted-foreground">
                                                                                        Intervalo de Almoço (Retorno):
                                                                                    </div>
                                                                                    <div>
                                                                                        {
                                                                                            userData?.lunch_break_return ?? "Não registrado"
                                                                                        }
                                                                                    </div>
                                                                                </div>
                                                                            </>
                                                                        )
                                                                    }

                                                                </div>
                                                            </div>
                                                        </div>
                                                        <DialogFooter>
                                                            {
                                                                hasPermissions && (
                                                                    <div className={"flex gap-4"}>
                                                                        <Button
                                                                            onClick={() => void router.push("/admin")}
                                                                            variant="default">
                                                                            Editar
                                                                        </Button>
                                                                    </div>
                                                                )
                                                            }
                                                        </DialogFooter>
                                                    </DialogContent>
                                                </Dialog>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                }) : (
                                    <Empty className="border-none py-8">
                                        <EmptyHeader>
                                            <EmptyMedia variant="icon">
                                                <ClockIcon/>
                                            </EmptyMedia>
                                            <EmptyTitle>Nenhum funcionário cadastrado</EmptyTitle>
                                            <EmptyDescription>
                                                Peça a um administrador para adicionar a equipe em Administração.
                                            </EmptyDescription>
                                        </EmptyHeader>
                                    </Empty>
                                )
                            }
                        </div>
                    </CardContent>
                </Card>
            </main>
        </>
    )
}