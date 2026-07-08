"use client"

import React, {useEffect, useState} from "react"
import {Progress} from "@/components/ui/progress"
import {Button} from "@/components/ui/button";
import TauriApi from "@/lib/Tauri";
import HoursSetup from "@/components/splashscreen/HoursSetup";
import PostgresSetup from "@/components/splashscreen/PostgresSetup";
import FirstUser from "@/components/splashscreen/FirstUser";
import SetupShell, {SetupLoadingShell} from "@/components/splashscreen/SetupShell";
import SetupStepHeader from "@/components/splashscreen/SetupStepHeader";
import {Check} from "lucide-react";

async function SetupDatabase(
    appName: string,
    uri?: string,
) {
    try {
        await TauriApi.SetupDatabase(appName, uri || "postgres://postgres:postgres@localhost:5432");
        return true
    } catch (e: any) {
        console.log(e)
        throw new Error(e?.message ?? e);
    }
}

const WELCOME_FEATURES = [
    {
        title: "Bata ponto em segundos",
        desc: "Cartão NFC no leitor ACR122U — sem fila, sem senha.",
    },
    {
        title: "Funciona offline",
        desc: "Registros locais sincronizados quando a conexão voltar.",
    },
    {
        title: "Segurança contra clonagem",
        desc: "Tokens rotativos bloqueiam cartões duplicados automaticamente.",
    },
] as const;

export default function Splashscreen() {
    const [currentStep, setCurrentStep] = useState(1)
    const [progress, setProgress] = useState(0)

    const [setupStep, setSetupStep] = useState(0)
    const [AppConfigured, setAppConfigured] = useState(false)

    const [postgresUri, setPostgresUri] = useState<string>("")
    const [appName, setAppName] = useState<string>("")

    const [horarioEntrada, setHorarioEntrada] = useState<string>("08:00:00")
    const [minutosTolerancia, setMinutosTolerancia] = useState<number>(10)
    const [horarioSaida, setHorarioSaida] = useState<string>("18:00:00")
    const [horarioSaidaFDS, setHorarioSaidaFDS] = useState<string>("")

    const [backendSetup, setBackendSetup] = useState(false);

    async function Setup(
        setBackendSetupFn: (value: boolean) => void,
        appName: string,
        uri?: string,
    ) {
        try {
            await SetupDatabase(appName, uri);
            await TauriApi.StartBackendServices();

            const hasAdmin = await TauriApi.HasAdmin();
            if (hasAdmin) {
                setBackendSetupFn(true);
            } else {
                setSetupStep(3);
            }

            return true
        } catch (e: any) {
            throw new Error(e?.message ?? e);
        }
    }

    useEffect(() => {
        if (localStorage.getItem("AppConfigured") === "true") {
            setBackendSetup(true)
        }
    }, []);

    useEffect(() => {
        if (!backendSetup || typeof window === "undefined") return;

        localStorage.setItem("AppConfigured", "true");
        setAppConfigured(true);

        const unlisten = TauriApi.ListenEvent("splashscreen:progress", (event) => {
            const newEvent = event.payload as [key: string, true]

            switch (newEvent[0]) {
                case "database":
                    setCurrentStep(2)
                    setProgress(30)
                    break
                case "cache":
                    setCurrentStep(3)
                    setProgress(60)
                    break
                case "finish":
                    setCurrentStep(4)
                    setProgress(100)
                    break
            }
        })

        const syncUnlisten = TauriApi.ListenEvent("sync:users", (event) => {
            console.log(event)
        })

        // Migrate work hours from localStorage for existing installations that
        // predate the app_config table. For new installs, handleHoursContinue
        // already wrote to SQLite; GetWorkHours returns a value so this is a no-op.
        void (async () => {
            try {
                const existing = await TauriApi.GetWorkHours();
                if (!existing) {
                    await TauriApi.SaveWorkHours({
                        entry: localStorage.getItem("HorarioEntrada") ?? "08:00:00",
                        exit: localStorage.getItem("HorarioSaida") ?? "17:00:00",
                        exitWeekend: localStorage.getItem("HorarioSaidaFDS") ?? "12:00:00",
                        toleranceMinutes: parseInt(localStorage.getItem("MinutosTolerancia") ?? "10", 10) || 10,
                    });
                }
            } catch (e) {
                console.error("[migration] work hours:", e);
            }
            TauriApi.SetupApp();
        })();

        return () => {
            unlisten.then(f => f());
            syncUnlisten.then(f => f());
        };
    }, [backendSetup])

    async function handleHoursContinue() {
        await TauriApi.SaveWorkHours({
            entry: horarioEntrada,
            exit: horarioSaida,
            exitWeekend: horarioSaidaFDS || "12:00:00",
            toleranceMinutes: minutosTolerancia,
        }).catch(console.error);
        setSetupStep(2);
    }

    if (AppConfigured) {
        return (
            <SetupLoadingShell>
                <div className="text-center">
                    <p className="text-lg font-medium">
                        {currentStep === 1 && "Iniciando aplicativo…"}
                        {currentStep === 2 && "Conectando ao banco de dados…"}
                        {currentStep === 3 && "Sincronizando equipe…"}
                        {currentStep === 4 && "Tudo pronto!"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {currentStep === 4
                            ? "Abrindo o terminal de ponto"
                            : "Isso leva apenas alguns segundos"}
                    </p>
                </div>
                <Progress value={progress} className="h-2"/>
            </SetupLoadingShell>
        );
    }

    return (
        <SetupShell setupStep={setupStep}>
            {setupStep === 0 && (
                <>
                    <SetupStepHeader
                        title="Controle de ponto simples para sua equipe"
                        description="Configure o PontuAll em poucos passos. Cartão NFC, relatórios e gestão — gratuito para pequenas empresas."
                    />
                    <ul className="mb-8 space-y-4">
                        {WELCOME_FEATURES.map((feature) => (
                            <li key={feature.title} className="flex gap-3">
                                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                                    <Check className="size-3"/>
                                </span>
                                <div>
                                    <p className="text-sm font-medium">{feature.title}</p>
                                    <p className="text-sm text-muted-foreground">{feature.desc}</p>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <Button className="w-full sm:w-auto" size="lg" onClick={() => setSetupStep(1)}>
                        Começar configuração
                    </Button>
                </>
            )}

            {setupStep === 1 && (
                <HoursSetup
                    horarioEntrada={horarioEntrada}
                    setHorarioEntrada={setHorarioEntrada}
                    minutosTolerancia={minutosTolerancia}
                    setMinutosTolerancia={setMinutosTolerancia}
                    horarioSaida={horarioSaida}
                    setHorarioSaida={setHorarioSaida}
                    horarioSaidaFDS={horarioSaidaFDS}
                    setHorarioSaidaFDS={setHorarioSaidaFDS}
                    setSetupStep={setSetupStep}
                    onContinue={handleHoursContinue}
                />
            )}

            {setupStep === 2 && (
                <PostgresSetup
                    postgresUri={postgresUri}
                    appName={appName}
                    setAppName={setAppName}
                    setPostgresUri={setPostgresUri}
                    setSetupStep={setSetupStep}
                    setBackendSetup={setBackendSetup}
                    Setup={Setup}
                />
            )}

            {setupStep === 3 && (
                <FirstUser
                    setSetupStep={setSetupStep}
                    onComplete={() => setBackendSetup(true)}
                />
            )}
        </SetupShell>
    );
}
