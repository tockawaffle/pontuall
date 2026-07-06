import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import React, {useState} from "react";
import {Check, X} from "lucide-react";
import TauriApi from "@/lib/Tauri";
import SetupStepHeader from "@/components/splashscreen/SetupStepHeader";
import {cn} from "@/lib/utils";

type FirstUserProps = {
    setSetupStep: React.Dispatch<React.SetStateAction<number>>,
    onComplete: () => void
}

interface PasswordRequirement {
    regex: RegExp
    message: string
}

const passwordRequirements: PasswordRequirement[] = [
    {regex: /.{10,}/, message: "Pelo menos 10 caracteres"},
    {regex: /[A-Z]/, message: "Pelo menos uma letra maiúscula"},
    {regex: /[a-z]/, message: "Pelo menos uma letra minúscula"},
    {regex: /[0-9]/, message: "Pelo menos um número"},
    {regex: /[^A-Za-z0-9]/, message: "Pelo menos um caractere especial"},
]

export default function FirstUser(
    {
        setSetupStep,
        onComplete
    }: FirstUserProps
) {
    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [error, setError] = useState("")
    const [busy, setBusy] = useState(false)

    const passwordOk = passwordRequirements.every(req => req.regex.test(password))
    const canSubmit = name.trim() !== "" && email.trim() !== "" && passwordOk && !busy

    async function handleCreate() {
        setError("")
        setBusy(true)
        try {
            // Backend stores the session for the new admin; the main window
            // picks it up via RestoreSession. No token is exposed to the webview.
            await TauriApi.BootstrapAdmin(name.trim(), email.trim(), password, "Administrador")
            onComplete()
        } catch (e: any) {
            setError(e?.message ?? "Não foi possível criar o administrador.")
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <SetupStepHeader
                title="Usuário administrador"
                description="Crie a conta que vai gerenciar funcionários, cartões e relatórios. Você pode adicionar outros administradores depois."
            />
            <div className="flex flex-col gap-5">
                <div className={"grid gap-2"}>
                    <Label htmlFor={"adminName"}>
                        Nome
                    </Label>
                    <Input
                        id="adminName"
                        placeholder="Nome completo"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>
                <div className={"grid gap-2"}>
                    <Label htmlFor={"adminEmail"}>
                        E-mail
                    </Label>
                    <Input
                        id="adminEmail"
                        type="email"
                        placeholder="admin@empresa.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                    />
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="adminPassword">Senha</Label>
                    <div className="relative">
                        <Input
                            id="adminPassword"
                            type="password"
                            placeholder="Senha"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="pr-10"
                            aria-describedby="admin-password-requirements"
                        />
                        {password && (
                            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3">
                                {passwordOk ? (
                                    <Check className="size-5 text-success"/>
                                ) : (
                                    <X className="size-5 text-destructive"/>
                                )}
                            </span>
                        )}
                    </div>
                    <div
                        id="admin-password-requirements"
                        className="rounded-lg border border-border bg-muted/30 p-3"
                    >
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                            A senha precisa ter:
                        </p>
                        <ul className="space-y-1.5">
                            {passwordRequirements.map((req, index) => {
                                const met = req.regex.test(password);

                                return (
                                    <li key={index} className="flex items-center gap-2 text-sm">
                                        {met ? (
                                            <Check className="size-4 shrink-0 text-success"/>
                                        ) : (
                                            <X className="size-4 shrink-0 text-muted-foreground"/>
                                        )}
                                        <span className={cn(met ? "text-foreground" : "text-muted-foreground")}>
                                            {req.message}
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
                {
                    error && (
                        <span className="text-sm text-red-500">{error}</span>
                    )
                }
                <div className="flex gap-3 pt-2">
                    <Button variant="outline" disabled={busy} onClick={() => setSetupStep(2)}>Voltar</Button>
                    <Button className="min-w-32" disabled={!canSubmit} onClick={handleCreate}>
                        {busy ? "Criando…" : "Concluir"}
                    </Button>
                </div>
            </div>
        </>
    )
}
