import { Label } from "@/components/ui/label";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import {Button} from "@/components/ui/button";
import React from "react";
import SetupStepHeader from "@/components/splashscreen/SetupStepHeader";

type HoursSetupProps = {
    horarioEntrada: string,
    setHorarioEntrada: (value: string) => void,
    minutosTolerancia: number,
    setMinutosTolerancia: (value: number) => void,
    horarioSaida: string,
    setHorarioSaida: (value: string) => void,
    horarioSaidaFDS: string,
    setHorarioSaidaFDS: (value: string) => void,
    setSetupStep: (value: number) => void,
    onContinue: () => void,
}

export default function HoursSetup(
    {
        horarioEntrada,
        setHorarioEntrada,
        minutosTolerancia,
        setMinutosTolerancia,
        horarioSaida,
        setHorarioSaida,
        horarioSaidaFDS,
        setHorarioSaidaFDS,
        setSetupStep,
        onContinue,
    }: HoursSetupProps
) {
    return (
        <>
            <SetupStepHeader
                title="Horários de trabalho"
                description="Defina a jornada padrão da equipe. Esses horários são usados para validar entradas, saídas e intervalos."
            />
            <div className="flex flex-col gap-5">
                <div className={"grid gap-2"}>
                    <Label htmlFor={"horarioEntrada"}>
                        Horário de Entrada
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id={"horarioEntrada"}
                                    type={"time"}
                                    placeholder={"00:00:00"}
                                    value={horarioEntrada.slice(0, 5)}
                                    onChange={(e) => setHorarioEntrada(e.target.value + ":00")}
                                />
                            </TooltipTrigger>
                            <TooltipContent
                                className={"text-center text-clip max-w-[500px]"}>
                                O horário de entrada é o horário em que os funcionários
                                devem bater o ponto.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className={"grid gap-2"}>
                    <Label htmlFor={"minTolerancia"}>
                        Minutos de Tolerância
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id={"minTolerancia"}
                                    type={"number"}
                                    max={60}
                                    placeholder={"10"}
                                    value={minutosTolerancia}
                                    onChange={(e) => setMinutosTolerancia(parseInt(e.target.value))}
                                />
                            </TooltipTrigger>
                            <TooltipContent
                                className={"text-center text-clip max-w-[500px]"}>
                                Os minutos de tolerância são os minutos que o
                                funcionário
                                pode atrasar sem ser penalizado. Normalmente o máximo
                                tolerado é de 10 minutos.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className={"grid gap-2"}>
                    <Label htmlFor={"horarioSaida"}>
                        Horário de Saída
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id={"horarioSaida"}
                                    type={"time"}
                                    placeholder={"00:00:00"}
                                    value={horarioSaida.slice(0, 5)}
                                    onChange={(e) => setHorarioSaida(e.target.value + ":00")}
                                />
                            </TooltipTrigger>
                            <TooltipContent
                                className={"text-center text-clip max-w-[500px]"}>
                                O horário de saída é o horário em que os funcionários
                                devem bater o ponto quando a jornada de trabalho
                                termina.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className={"grid gap-2"}>
                    <Label htmlFor={"horarioSaidaFDS"}>
                        Horário de Saída - Finais de Semana
                    </Label>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Input
                                    id={"horarioSaidaFDS"}
                                    type={"time"}
                                    placeholder={"00:00:00"}
                                    value={horarioSaidaFDS ? horarioSaidaFDS.slice(0, 5) : ""}
                                    onChange={(e) => {
                                        setHorarioSaidaFDS(e.target.value ? e.target.value + ":00" : "")
                                    }}
                                />
                            </TooltipTrigger>
                            <TooltipContent
                                className={"text-center text-clip max-w-[500px]"}>
                                Este horário é opcional, caso não seja preenchido, o
                                horário de saída padrão será utilizado.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <div className="flex gap-3 pt-2">
                    <Button variant="outline" onClick={() => setSetupStep(0)}>Voltar</Button>
                    <Button className="min-w-32" onClick={onContinue} disabled={
                        horarioEntrada === "" || minutosTolerancia === 0 || horarioSaida === ""
                    }>Continuar</Button>
                </div>
            </div>
        </>
    )
}