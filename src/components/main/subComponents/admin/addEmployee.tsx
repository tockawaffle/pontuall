import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {Button} from "@/components/ui/button";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {SpinnerIcon, SuccessCircle} from "@/components/component/icons";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import React, {useEffect, useState} from "react";
import TauriApi from "@/lib/Tauri";
import {toast} from "sonner";
import {ChevronDown, UserPlus} from "lucide-react";
import {
    ACCESS_LEVEL_LABELS,
    type PontuallAccessLevel,
    normalizeAccessLevel,
} from "@/lib/pontuall-permissions";

type WizardStep = "identification" | "access" | "card";

type AddEmployeeProps = {
    setUsers: React.Dispatch<React.SetStateAction<Users | []>>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultLunchTime?: string;
};

const EMPTY_FORM = {
    name: "",
    email: "",
    role: "",
    lunch_time: "12:00",
    phone: "",
};

function StepIndicator({step}: {step: WizardStep}) {
    const steps: {id: WizardStep; label: string}[] = [
        {id: "identification", label: "Dados"},
        {id: "access", label: "Acesso"},
        {id: "card", label: "Cartão"},
    ];
    const currentIndex = steps.findIndex((s) => s.id === step);

    return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {steps.map((s, index) => (
                <React.Fragment key={s.id}>
                    <span
                        className={
                            index <= currentIndex
                                ? "font-medium text-foreground"
                                : undefined
                        }
                    >
                        {index + 1}. {s.label}
                    </span>
                    {index < steps.length - 1 && <span aria-hidden>→</span>}
                </React.Fragment>
            ))}
        </div>
    );
}

export default function AddEmployee({
    setUsers,
    open,
    onOpenChange,
    defaultLunchTime = "12:00",
}: AddEmployeeProps) {
    const [step, setStep] = useState<WizardStep>("identification");
    const [createdEmployeeId, setCreatedEmployeeId] = useState<string | null>(null);
    const [createdEmployeeName, setCreatedEmployeeName] = useState("");
    const [cardProvisioning, setCardProvisioning] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [optionalOpen, setOptionalOpen] = useState(false);
    const [form, setForm] = useState({...EMPTY_FORM, lunch_time: defaultLunchTime});
    const [accessLevel, setAccessLevel] = useState<PontuallAccessLevel>("employee");
    const [smtpConfigured, setSmtpConfigured] = useState(false);
    const [error, setError] = useState("");
    const [formatPromptOpen, setFormatPromptOpen] = useState(false);

    useEffect(() => {
        if (open) {
            setForm({...EMPTY_FORM, lunch_time: defaultLunchTime});
            TauriApi.GetSmtpConfig()
                .then((config) => setSmtpConfigured(Boolean(config?.configured)))
                .catch(() => setSmtpConfigured(false));
        }
    }, [open, defaultLunchTime]);

    function resetWizard() {
        setStep("identification");
        setCreatedEmployeeId(null);
        setCreatedEmployeeName("");
        setCardProvisioning(false);
        setSubmitting(false);
        setOptionalOpen(false);
        setForm({...EMPTY_FORM, lunch_time: defaultLunchTime});
        setAccessLevel("employee");
        setError("");
        setFormatPromptOpen(false);
    }

    function handleClose() {
        if (cardProvisioning) {
            void TauriApi.CancelCard().catch(() => undefined);
        }
        resetWizard();
        onOpenChange(false);
    }

    async function refreshUsers() {
        const data = await TauriApi.GetCache();
        const nextUsers = Object.values(data) as Users;
        setUsers(nextUsers);
    }

    async function handleRegister() {
        setError("");
        setSubmitting(true);
        try {
            const id = await TauriApi.GenerateUserId();

            const inserted = await TauriApi.InsertNewUser(
                id,
                form.name.trim(),
                form.email.trim(),
                form.role.trim(),
                form.lunch_time || defaultLunchTime,
                form.phone.trim() || "",
            );

            if (!inserted) {
                throw new Error("Não foi possível cadastrar o funcionário.");
            }

            if (smtpConfigured) {
                await TauriApi.CreateAccount(
                    id,
                    form.email.trim(),
                    accessLevel,
                );
            }

            await refreshUsers();
            setCreatedEmployeeId(id);
            setCreatedEmployeeName(form.name.trim());
            setStep("card");
            toast.success(`${form.name.trim()} cadastrado`, {
                description: smtpConfigured
                    ? "Link para definir a senha enviado por e-mail. Próximo passo: vincular o cartão NFC (opcional)."
                    : "Próximo passo: vincular o cartão NFC (opcional).",
            });
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : "Erro ao cadastrar funcionário.";
            setError(message);
        } finally {
            setSubmitting(false);
        }
    }

    async function handleProvisionCard(force = false) {
        if (!createdEmployeeId) return;
        setError("");
        setFormatPromptOpen(false);
        setCardProvisioning(true);
        try {
            await TauriApi.ProvisionCard(createdEmployeeId, force);
            toast.success("Cartão vinculado", {
                description: `${createdEmployeeName} já pode bater ponto com o cartão.`,
            });
            handleClose();
        } catch (e: unknown) {
            const code = (e as {code?: string})?.code;
            const message =
                (e as {message?: string})?.message ??
                (e instanceof Error ? e.message : "Não foi possível provisionar o cartão.");
            // A non-blank/foreign card can be reused if the admin agrees to wipe it.
            if (code === "card_not_blank") {
                setFormatPromptOpen(true);
            } else {
                setError(message);
            }
        } finally {
            setCardProvisioning(false);
        }
    }

    function handleSkipCard() {
        toast.message("Cadastro concluído", {
            description: "Você pode vincular um cartão depois, na ficha do funcionário.",
        });
        handleClose();
    }

    const identificationValid =
        form.name.trim().length > 0 &&
        form.email.trim().length > 0 &&
        form.role.trim().length > 0;


    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) {
                    handleClose();
                    return;
                }
                onOpenChange(true);
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Novo funcionário</DialogTitle>
                    <DialogDescription>
                        {step === "identification" &&
                            "Comece pelos dados essenciais. Detalhes extras ficam opcionais."}
                        {step === "access" &&
                            "Defina o nível de acesso. A senha é criada pelo próprio funcionário via link enviado por e-mail."}
                        {step === "card" &&
                            "Cadastro concluído. Vincule um cartão agora ou faça isso depois."}
                    </DialogDescription>
                </DialogHeader>

                <StepIndicator step={step}/>

                {error && <p className="text-sm text-destructive">{error}</p>}

                {step === "identification" && (
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="new-employee-name">Nome</Label>
                            <Input
                                id="new-employee-name"
                                value={form.name}
                                maxLength={24}
                                placeholder="Ex.: Maria Silva"
                                onChange={(e) => setForm({...form, name: e.target.value})}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-employee-email">E-mail</Label>
                            <Input
                                id="new-employee-email"
                                type="email"
                                value={form.email}
                                placeholder="Usado no login e comunicações"
                                onChange={(e) => setForm({...form, email: e.target.value})}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-employee-role">Cargo</Label>
                            <Input
                                id="new-employee-role"
                                value={form.role}
                                placeholder="Ex.: Operador de caixa"
                                onChange={(e) => setForm({...form, role: e.target.value})}
                            />
                        </div>
                        <Collapsible open={optionalOpen} onOpenChange={setOptionalOpen}>
                            <CollapsibleTrigger asChild>
                                <Button variant="ghost" size="sm" className="w-fit gap-1 px-0">
                                    Campos opcionais
                                    <ChevronDown
                                        className={`h-4 w-4 transition-transform ${optionalOpen ? "rotate-180" : ""}`}
                                    />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="grid gap-4 pt-2">
                                <div className="grid gap-2">
                                    <Label htmlFor="new-employee-lunch">Horário de almoço</Label>
                                    <Input
                                        id="new-employee-lunch"
                                        type="time"
                                        value={form.lunch_time}
                                        onChange={(e) => setForm({...form, lunch_time: e.target.value})}
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="new-employee-phone">Celular</Label>
                                    <Input
                                        id="new-employee-phone"
                                        type="tel"
                                        value={form.phone}
                                        placeholder="Para contato ou validação de ponto"
                                        onChange={(e) => setForm({...form, phone: e.target.value})}
                                    />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </div>
                )}

                {step === "access" && (
                    <div className="grid gap-4">
                        <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                            <p className="font-medium">{form.name}</p>
                            <p className="text-muted-foreground">{form.email} · {form.role}</p>
                        </div>
                        {smtpConfigured ? (
                            <p className="text-sm text-muted-foreground">
                                A senha será definida pelo próprio funcionário: um link de uso
                                único será enviado para <strong>{form.email}</strong>.
                            </p>
                        ) : (
                            <p className="text-sm text-destructive">
                                Servidor de e-mail (SMTP) não configurado — o funcionário será
                                cadastrado sem conta de acesso. Configure o SMTP em Configurações
                                e ative o login depois, na aba Logins.
                            </p>
                        )}
                        {smtpConfigured && (
                            <div className="grid gap-2">
                                <Label htmlFor="new-employee-access-level">Nível de acesso</Label>
                                <select
                                    id="new-employee-access-level"
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    value={accessLevel}
                                    onChange={(e) =>
                                        setAccessLevel(e.target.value as PontuallAccessLevel)
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
                                <p className="text-xs text-muted-foreground">
                                    Padrão: funcionário — altere apenas se precisar de supervisão ou
                                    administração.
                                </p>
                            </div>
                        )}
                    </div>
                )}

                {step === "card" && (
                    <div className="flex flex-col items-center gap-4 py-4 text-center">
                        {cardProvisioning ? (
                            <>
                                <p className="text-sm">
                                    Aproxime um cartão em branco do leitor para vincular a{" "}
                                    <strong>{createdEmployeeName}</strong>.
                                </p>
                                <SpinnerIcon className="h-16 w-16 animate-spin"/>
                            </>
                        ) : (
                            <>
                                <SuccessCircle className="h-12 w-12 text-green-600 dark:text-green-500"/>
                                <p className="text-sm text-muted-foreground max-w-sm">
                                    <strong>{createdEmployeeName}</strong> já está no sistema. O
                                    cartão NFC acelera o ponto no terminal — mas pode ser
                                    configurado depois.
                                </p>
                            </>
                        )}
                    </div>
                )}

                <DialogFooter className="gap-2 sm:gap-0">
                    {step === "identification" && (
                        <>
                            <Button variant="outline" onClick={handleClose}>
                                Cancelar
                            </Button>
                            <Button
                                disabled={!identificationValid}
                                onClick={() => {
                                    setError("");
                                    setStep("access");
                                }}
                            >
                                Continuar
                            </Button>
                        </>
                    )}
                    {step === "access" && (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setStep("identification")}
                                disabled={submitting}
                            >
                                Voltar
                            </Button>
                            <Button
                                disabled={submitting}
                                onClick={() => void handleRegister()}
                            >
                                {submitting ? "Cadastrando…" : "Cadastrar funcionário"}
                            </Button>
                        </>
                    )}
                    {step === "card" && !cardProvisioning && (
                        <>
                            <Button variant="outline" onClick={handleSkipCard}>
                                Concluir sem cartão
                            </Button>
                            <Button onClick={() => void handleProvisionCard()}>
                                Vincular cartão agora
                            </Button>
                        </>
                    )}
                    {step === "card" && cardProvisioning && (
                        <Button
                            variant="outline"
                            onClick={() => {
                                void TauriApi.CancelCard().catch(() => undefined);
                                setCardProvisioning(false);
                            }}
                        >
                            Cancelar leitura
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>

            <AlertDialog open={formatPromptOpen} onOpenChange={setFormatPromptOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Formatar e vincular este cartão?</AlertDialogTitle>
                        <AlertDialogDescription>
                            O cartão não está em branco ou pertence a outro sistema. Você pode
                            formatá-lo e vinculá-lo a <strong>{createdEmployeeName}</strong>, mas
                            isso apaga todo o conteúdo atual do cartão. Continue apenas se o cartão
                            for seu.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => void handleProvisionCard(true)}
                        >
                            Formatar e vincular
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Dialog>
    );
}

export function AddEmployeeTrigger({
    onClick,
    label = "Adicionar funcionário",
    size = "default",
}: {
    onClick: () => void;
    label?: string;
    size?: "default" | "sm" | "lg";
}) {
    return (
        <Button variant="secondary" size={size} onClick={onClick} className="gap-2">
            <UserPlus className="h-4 w-4"/>
            {label}
        </Button>
    );
}
