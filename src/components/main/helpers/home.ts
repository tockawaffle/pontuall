import TauriApi from "@/lib/Tauri";
import React from "react";
import moment from "moment/moment";

function handleSkipValidation(
    skipValidation: {
        type: "ClockLunchOut" | "ClockLunchReturn" | "ClockOut"
    },
    user: IUsers,
    time: {
        hour: string,
        date: string,
        datetime: string
    },
    check: any,
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string
        subMessage?: string[]
        type: string
        showDefaultCancel?: boolean
        release?: string
    }>>,
    users: Users,
    setUsers: React.Dispatch<React.SetStateAction<Users>>,
    punchSource: "card" | "manual_otp" = "card",
): void {
    TauriApi.UpdateUser(user.id, time.date, skipValidation.type, time.hour, punchSource).then((bool) => {
        if (bool) {
            updateUserHourData(user, time, check, skipValidation.type, setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
            displaySuccessMessage(skipValidation.type, user, setDialogMessage, setMessageDialogOpen);
        }
    }).catch((e) => {
        setDialogMessage({
            message: e,
            type: "destroy"
        });
    })
}

function handleRegularDayLogic(
    user: IUsers,
    time: {
        hour: string,
        date: string,
        datetime: string,
    },
    check: HourData,
    HorarioEntrada: string | null,
    MinutosTolerancia: string | null,
    HorarioSaida: string | null,
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>, setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string,
        subMessage?: string[],
        type: string,
        showDefaultCancel?: boolean,
        release?: string
    }>>,
    users: Users,
    setUsers: React.Dispatch<React.SetStateAction<Users>>,
    punchSource: "card" | "manual_otp" = "card",
): void {
    if (!HorarioEntrada || !MinutosTolerancia || !HorarioSaida) {
        alert("Você não configurou o horário de entrada e a tolerância de minutos.");
        return;
    }

    const lunchTime = user.lunch_time?.split(":");
    const clockedLunchTime = (): string[] => {
        const clockedLunch = check?.lunch_break_out;
        return clockedLunch ? clockedLunch.split(":") : lunchTime!;
    }

    if (!check) {
        updateUserHourData(user, time, {}, "ClockIn", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
        return
    } else if (Object.keys(check).length < 0) {
        updateUserHourData(user, time, check, "ClockIn", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
        return;
    }

    function checkValue(check: HourData, key: keyof HourData): boolean {
        return Boolean(check[key] && (check[key] !== "N/A"));
    }

    switch (true) {
        case !checkValue(check, "clock_in"): {
            const HorarioEntradaDate = moment(`${HorarioEntrada}`, "HH:mm");
            const currentTime = moment(Date.now());

            // Check if the user is trying to clock in before the minimum time
            if (currentTime.isBefore(HorarioEntradaDate.subtract(parseInt(MinutosTolerancia), 'minutes'))) {
                // Show warning if it's too early to clock in
                setDialogMessage({
                    message: `O ponto de entrada deve ser batido após as ${HorarioEntradaDate.format("HH:mm:ss")}`,
                    type: "warning",
                });
                setMessageDialogOpen(true);
                return;
            }

            updateUserHourData(user, time, check, "ClockIn", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
            break;
        }
        case !checkValue(check, "lunch_break_out"): {
            const lunch_time = user.lunch_time;
            if (!lunch_time) {
                setDialogMessage({
                    message: `O horário de almoço não foi configurado para o usuário. Deseja bater o ponto de saída agora?`,
                    type: "warning",
                    release: "clock_out"
                });
                setMessageDialogOpen(true);
                return;
            }

            const MinLunchTimeDate = moment(`${user.lunch_time}`, "HH:mm");
            const currentTime = moment(Date.now());

            // Check if the user is trying to clock out before the minimum time
            if (currentTime.isBefore(MinLunchTimeDate.subtract(parseInt(MinutosTolerancia), 'minutes'))) {
                // Show warning if it's too early to clock out for lunch
                setDialogMessage({
                    message: `O ponto de saída/retorno do almoço deve ser batido após as ${MinLunchTimeDate.format("HH:mm:ss")} - T01`,
                    type: "warning",
                    release: "clock_out"
                });
                setMessageDialogOpen(true);
                return;
            } else if (currentTime.isAfter(moment(`${user.lunch_time}`, "HH:mm").add(parseInt(MinutosTolerancia), 'minutes'))) {
                // Show warning if it's too late to clock out for lunch
                setDialogMessage({
                    message: `O ponto de saída/retorno do almoço deve ser batido após às ${MinLunchTimeDate.format("HH:mm:ss")} - T02`,
                    type: "warning",
                    release: "clock_out"
                });
                setMessageDialogOpen(true);
                return;
            }

            updateUserHourData(user, time, check, "ClockLunchOut", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
            break;
        }
        case !checkValue(check, "lunch_break_return"): {
            const lunchStartTime = moment(clockedLunchTime().join(":"), "HH:mm");
            const MaxLunchTimeDate = lunchStartTime.clone().add(1, 'hour');

            const currentTime = moment(Date.now());

            // Calculate the maximum allowed time for lunch return, considering the tolerance
            const maxAllowedTimeForReturn = MaxLunchTimeDate.clone().add(parseInt(MinutosTolerancia), 'minutes');
            const minAllowedTimeForReturn = MaxLunchTimeDate.clone().subtract(parseInt(MinutosTolerancia), 'minutes');
            console.debug(
                `Lunch Start Time: ${lunchStartTime.format("HH:mm:ss")}\n`,
                `Max Lunch Time: ${MaxLunchTimeDate.format("HH:mm:ss")}\n`,
                `Max Allowed Time: ${maxAllowedTimeForReturn.format("HH:mm:ss")}\n`,
                `Min Allowed Time: ${minAllowedTimeForReturn.format("HH:mm:ss")}\n`,
                `Current Time: ${currentTime.format("HH:mm:ss")}\n`
            )

            // Check if the user is trying to clock in after the maximum time
            if (currentTime.isAfter(maxAllowedTimeForReturn)) {
                // Show warning if it's too late to clock in after lunch
                setDialogMessage({
                    message: `O ponto de retorno do almoço deve ser batido antes das ${maxAllowedTimeForReturn.format("HH:mm:ss")}`,
                    type: "warning",
                    release: "clock_out"
                });
                setMessageDialogOpen(true);
                return;
            } else if (currentTime.isBefore(minAllowedTimeForReturn)) {
                console.debug(`Hey ${user.name}!\nCalm down big boy, you can't return yet! Go do something else while you wait lmao.`)
                // Show warning if it's too early to clock in after lunch
                setDialogMessage({
                    message: `O ponto de retorno do almoço deve ser batido após as ${minAllowedTimeForReturn.format("HH:mm:ss")}, deseja bater o retorno agora?`,
                    type: "bypass-clock-lunch-return",
                    showDefaultCancel: true
                });
                setMessageDialogOpen(true);
                return;
            }

            // Proceed with updating user hour data if it's time or if the user wants to skip the validation
            updateUserHourData(user, time, check, "ClockLunchReturn", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
            return;
        }
        case !checkValue(check, "clocked_out"): {
            const HorarioSaidaDate = moment(`${HorarioSaida}`, "HH:mm");
            const currentTime = moment(Date.now());

            console.log(HorarioSaidaDate.toString());
            console.log(currentTime.toString());
            // Ask if the user wants to clock out early
            if (currentTime.isBefore(HorarioSaidaDate)) {
                console.log("OK")
                // Calculate time left to clock out
                const timeLeft = HorarioSaidaDate.diff(currentTime);
                const duration = moment.duration(timeLeft);
                const hoursLeft = duration.hours();
                const minutesLeft = duration.minutes();
                const secondsLeft = duration.seconds();
                setDialogMessage({
                    message: `Faltam ${hoursLeft} horas, ${minutesLeft} minutos e ${secondsLeft} segundos para bater o ponto de saída. Você deseja bater o ponto de saída agora?`,
                    type: "bypass-clock-out",
                    showDefaultCancel: true
                });
                setMessageDialogOpen(true);
                return;
            }

            updateUserHourData(user, time, check, "ClockOut", setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
            return;
        }
        default: {
            setDialogMessage({
                message: `Você já bateu todos os pontos de hoje.`,
                type: "info"
            });
            setMessageDialogOpen(true);
            return;
        }
    }
}

function getLocalStorageValues(): {
    HorarioEntrada: string | null;
    MinutosTolerancia: string | null;
    HorarioSaida: string | null;
    HorarioSaidaFDS: string | null
} {
    return {
        HorarioEntrada: localStorage.getItem("HorarioEntrada"),
        MinutosTolerancia: localStorage.getItem("MinutosTolerancia"),
        HorarioSaida: localStorage.getItem("HorarioSaida"),
        HorarioSaidaFDS: localStorage.getItem("HorarioSaidaFDS") ?? localStorage.getItem("HorarioSaida"),
    };
}

function getGreetingForTime(): string {
    const hour = new Date().getHours();
    if (hour < 12) return "Bom dia";
    if (hour < 18) return "Boa tarde";
    return "Boa noite";
}

function displaySuccessMessage(
    type: "ClockLunchOut" | "ClockLunchReturn" | "ClockOut" | "ClockIn",
    user: IUsers,
    setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string
        subMessage?: string[]
        type: string
        showDefaultCancel?: boolean
        release?: string
    }>>,
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>
): void {
    let message = "";
    let dialog_type = "";
    let sub_message: string[] = [];

    const greeting = getGreetingForTime();

    switch (type) {
        case "ClockIn":
            dialog_type = "success";
            message = "Entrada registrada!";
            sub_message = [`${greeting}, ${user.name}!`, `Seu ponto de entrada foi registrado.`, `Bom trabalho!`];
            break;
        case "ClockLunchOut":
            dialog_type = "success";
            message = "Saída para almoço registrada!";
            sub_message = [`${greeting}, ${user.name}!`, `Aproveite seu intervalo.`, `Bom apetite!`];
            break;
        case "ClockLunchReturn":
            dialog_type = "success";
            message = "Retorno do almoço registrado!";
            sub_message = [`${greeting}, ${user.name}!`, `Bem-vindo de volta.`, `Boa tarde de trabalho!`];
            break;
        case "ClockOut":
            dialog_type = "success";
            message = "Saída registrada!";
            sub_message = [`${greeting}, ${user.name}!`, `Seu expediente de hoje foi encerrado.`, `Até amanhã!`];
            break;
    }
    setDialogMessage({message, type: dialog_type, subMessage: sub_message});
    setMessageDialogOpen(true);
}


function updateUserHourData(
    user: IUsers,
    time: {
        hour: string,
        date: string,
        datetime: string
    },
    check: any,
    type: "ClockLunchOut" | "ClockLunchReturn" | "ClockOut" | "ClockIn",
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string
        subMessage?: string[]
        type: string
        showDefaultCancel?: boolean
        release?: string
    }>>,
    users: Users,
    setUsers: React.Dispatch<React.SetStateAction<Users>>,
    punchSource: "card" | "manual_otp" = "card",
): void {
    TauriApi.UpdateUser(user.id, time.date, type, time.hour, punchSource).then((bool) => {
        if (bool) {
            displaySuccessMessage(type, user, setDialogMessage, setMessageDialogOpen);
            setUsers(users.map((u) => {
                if (u.id === user.id) {
                    return {
                        ...u,
                        hour_data: {
                            ...u.hour_data,
                            [time.date]: {
                                ...check,
                                [type === "ClockIn" ? "clock_in" : type === "ClockOut" ? "clocked_out" : type === "ClockLunchOut" ? "lunch_break_out" : "lunch_break_return"]: time.hour
                            }
                        }
                    }
                }
                return u;
            }));
        }
    }).catch((e) => {
        setMessageDialogOpen(true);
        setDialogMessage({
            message: e,
            type: "destroy"
        });
    })
}

async function HandleClockIn(
    user: IUsers,
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string,
        subMessage?: string[],
        type: string,
        showDefaultCancel?: boolean,
        release?: string
    }>>,
    users: Users,
    setUsers: React.Dispatch<React.SetStateAction<Users>>,
    skipValidation?: {
        type: "ClockLunchOut" | "ClockLunchReturn" | "ClockOut",
    },
    punchSource: "card" | "manual_otp" = "card",
): Promise<void> {
    const time = await GetApiTime();

    const check = user.hour_data[time.date];

    if (skipValidation) {
        handleSkipValidation(skipValidation, user, time, check, setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
        return;
    }

    const {HorarioEntrada, MinutosTolerancia, HorarioSaida} = getLocalStorageValues();
    if (!HorarioEntrada || !MinutosTolerancia) {
        alert("Você não configurou o horário de entrada e a tolerância de minutos.");
        return;
    }

    handleRegularDayLogic(user, time, check, HorarioEntrada, MinutosTolerancia, HorarioSaida, setMessageDialogOpen, setDialogMessage, users, setUsers, punchSource);
}

async function HandleCloseRead(
    setClockUser: React.Dispatch<React.SetStateAction<IUsers | null>>
) {
    setClockUser(null);

    try {
        if (typeof window !== "undefined") {
            await TauriApi.CancelCard()
        }
    } catch (e: any) {
        console.log(e)
    }
}

async function GetApiTime() {

    const hour = new Date().toLocaleTimeString("pt-BR", {
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
    });

    const date = new Date().toLocaleDateString("pt-BR", {
        year: "numeric",
        month: "numeric",
        day: "numeric"
    });

    const datetime = new Date().toLocaleString("pt-BR", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
    });

    return {
        hour,
        date,
        datetime
    }
}

async function HandleGetUser(
    setOpenPunchDialog: React.Dispatch<React.SetStateAction<boolean>>,
    users: Users,
    setClockUser: React.Dispatch<React.SetStateAction<IUsers | null>>,
    setMessageDialogOpen: React.Dispatch<React.SetStateAction<boolean>>,
    setDialogMessage: React.Dispatch<React.SetStateAction<{
        message: string,
        subMessage?: string[],
        type: string,
        showDefaultCancel?: boolean,
        release?: string
    }>>,
    setUsers: React.Dispatch<React.SetStateAction<Users>>,
    skipValidation?: {
        type: "ClockLunchOut" | "ClockLunchReturn" | "ClockOut",
    }
) {
    setOpenPunchDialog(true);

    try {
        if (typeof window !== "undefined") {
            const result = await TauriApi.AwaitTap();

            switch (result.outcome) {
                case "ok": {
                    const user = users.find(user => user.id === result.employee_id);
                    if (user) {
                        setClockUser(user);
                        await HandleClockIn(user, setMessageDialogOpen, setDialogMessage, users, setUsers, skipValidation);
                    } else {
                        setDialogMessage({
                            message: `Funcionário do cartão não encontrado.`,
                            type: "destroy"
                        });
                        setMessageDialogOpen(true);
                        await HandleCloseRead(setClockUser);
                    }
                    break;
                }
                case "unknown_card": {
                    setDialogMessage({
                        message: "Cartão não registrado.",
                        type: "destroy"
                    });
                    setMessageDialogOpen(true);
                    await HandleCloseRead(setClockUser);
                    break;
                }
                case "blocked": {
                    setDialogMessage({
                        message: "Este cartão foi bloqueado. Procure um administrador.",
                        type: "destroy"
                    });
                    setMessageDialogOpen(true);
                    await HandleCloseRead(setClockUser);
                    break;
                }
                case "clone_detected": {
                    setDialogMessage({
                        message: "Cartão clonado detectado! O cartão foi bloqueado e um administrador foi notificado.",
                        type: "destroy"
                    });
                    setMessageDialogOpen(true);
                    await HandleCloseRead(setClockUser);
                    break;
                }
            }
        }
    } catch (e: any) {
        console.log(e);
        setDialogMessage({
            message: e?.message ?? "Erro ao tentar ler o cartão.",
            type: "destroy"
        });
    }
}

export {
    HandleClockIn,
    HandleCloseRead,
    GetApiTime,
    HandleGetUser,
    handleRegularDayLogic,
    handleSkipValidation
}