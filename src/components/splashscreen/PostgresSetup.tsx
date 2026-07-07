import { Label } from "@/components/ui/label";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import React, {useState} from "react";
import TauriApi from "@/lib/Tauri";
import SetupStepHeader from "@/components/splashscreen/SetupStepHeader";

type PostgresSetupProps = {
    appName: string,
    setAppName: React.Dispatch<React.SetStateAction<string>>,
    postgresUri: string,
    setPostgresUri: React.Dispatch<React.SetStateAction<string>>,
    setSetupStep: React.Dispatch<React.SetStateAction<number>>,
    setBackendSetup: (value: boolean) => void
    Setup: (setBackendSetup: (value: boolean) => void, appName: string, postgresUri: string) => Promise<boolean>
}

export default function PostgresSetup(
    {
        appName,
        setAppName,
        postgresUri,
        setPostgresUri,
        setSetupStep,
        setBackendSetup,
        Setup
    }: PostgresSetupProps
) {
    const [error, setError] = useState<string>("");
    const [tlsWarning, setTlsWarning] = useState<string>("");
    const [busy, setBusy] = useState<boolean>(false);

    async function handleFinish() {
        setError("");
        setBusy(true);
        try {
            const warning = await TauriApi.TestDatabase(postgresUri || "postgres://postgres:postgres@localhost:5432");
            // First click surfaces the TLS warning; a second click proceeds.
            if (warning && !tlsWarning) {
                setTlsWarning(warning);
                return;
            }
            await Setup(setBackendSetup, appName, postgresUri);
        } catch (e: any) {
            setError(e?.message ?? "Não foi possível conectar ao banco de dados.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <>
            <SetupStepHeader
                title="Banco de dados"
                description="Informe o nome da empresa e a conexão PostgreSQL. O PontuAll cria o banco automaticamente na primeira execução."
            />
            <div className="flex flex-col gap-5">
                <div className="grid gap-2">
                    <Label htmlFor="companyName">Nome da aplicação</Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id="companyName"
                                    placeholder="minha-empresa"
                                    value={appName}
                                    onChange={(e) => setAppName(e.target.value)}
                                />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-center">
                                Nome curto da empresa ou projeto, sem espaços. Exemplo: pontuall
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="grid gap-2">
                    <Label htmlFor="postgresUri">URI do PostgreSQL</Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id="postgresUri"
                                    placeholder="postgres://usuario:senha@localhost:5432"
                                    value={postgresUri}
                                    onChange={(e) => {
                                        setPostgresUri(e.target.value);
                                        setTlsWarning("");
                                    }}
                                />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs text-center">
                                Endereço de conexão com o servidor PostgreSQL.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                {
                    error && (
                        <span className="text-sm text-red-500">{error}</span>
                    )
                }
                {
                    tlsWarning && (
                        <span className="text-sm text-amber-500">{tlsWarning}</span>
                    )
                }
                <div className="flex gap-3 pt-2">
                    <Button variant="outline" disabled={busy} onClick={() => setSetupStep(1)}>Voltar</Button>
                    <Button className="min-w-32" disabled={busy || !appName} onClick={handleFinish}>
                        {busy ? "Conectando…" : tlsWarning ? "Continuar mesmo assim" : "Continuar"}
                    </Button>
                </div>
            </div>
        </>
    )
}
