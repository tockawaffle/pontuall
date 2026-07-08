import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from "react";
import TauriApi from "@/lib/Tauri";

export type ThemeId = "deepsea" | "midnight" | "pastel" | "daylight" | "sunset";

export type WorkHoursConfig = {
    entry: string;
    exit: string;
    exitWeekend: string;
    toleranceMinutes: number;
};

export type SessionStatus = "loading" | "guest" | "authenticated";

type AppContextValue = {
    userLogged: UserLogged | Record<string, never>;
    setUserLogged: React.Dispatch<React.SetStateAction<UserLogged | Record<string, never>>>;
    sessionStatus: SessionStatus;
    completeLogin: (user: UserLogged) => void;
    logout: () => void;
    users: Users | [];
    setUsers: React.Dispatch<React.SetStateAction<Users | []>>;
    version: { version: string; versionName: string };
    theme: ThemeId;
    setTheme: (theme: ThemeId) => void;
    hourFormat: "HH:MM" | "HH:MM:SS";
    setHourFormat: (format: "HH:MM" | "HH:MM:SS") => void;
    dateFormat: "12" | "24";
    setDateFormat: (format: "12" | "24") => void;
    timezone: string;
    setTimezone: (tz: string) => void;
    clock: string;
    workHours: WorkHoursConfig;
    setWorkHours: React.Dispatch<React.SetStateAction<WorkHoursConfig>>;
    readerConnected: boolean | null;
    refreshUsers: () => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

function readStorage(key: string, fallback: string) {
    if (typeof window === "undefined") return fallback;
    return localStorage.getItem(key) ?? fallback;
}

function loadWorkHours(): WorkHoursConfig {
    if (typeof window === "undefined") {
        return {
            entry: "08:00:00",
            exit: "17:00:00",
            exitWeekend: "12:00:00",
            toleranceMinutes: 10,
        };
    }
    return {
        entry: readStorage("HorarioEntrada", "08:00:00"),
        exit: readStorage("HorarioSaida", "17:00:00"),
        exitWeekend: readStorage("HorarioSaidaFDS", "12:00:00"),
        toleranceMinutes: Number.parseInt(readStorage("MinutosTolerancia", "10"), 10) || 10,
    };
}

export function AppProvider({children}: { children: React.ReactNode }) {
    const [userLogged, setUserLogged] = useState<UserLogged | Record<string, never>>({});
    const [sessionStatus, setSessionStatus] = useState<SessionStatus>("loading");
    const [users, setUsers] = useState<Users | []>([]);
    const [version, setVersion] = useState({version: "", versionName: ""});
    const [theme, setThemeState] = useState<ThemeId>("midnight");
    const [hourFormat, setHourFormatState] = useState<"HH:MM" | "HH:MM:SS">("HH:MM");
    const [dateFormat, setDateFormatState] = useState<"12" | "24">("24");
    const [timezone, setTimezoneState] = useState("America/Sao_Paulo");
    const [clock, setClock] = useState("");
    const [workHours, setWorkHours] = useState<WorkHoursConfig>(loadWorkHours);
    const [readerConnected, setReaderConnected] = useState<boolean | null>(null);

    const setTheme = useCallback((value: ThemeId) => {
        document.documentElement.setAttribute("data-theme", value);
        localStorage.setItem("theme", value);
        setThemeState(value);
    }, []);

    const setHourFormat = useCallback((value: "HH:MM" | "HH:MM:SS") => {
        localStorage.setItem("hour-format", value);
        setHourFormatState(value);
    }, []);

    const setDateFormat = useCallback((value: "12" | "24") => {
        localStorage.setItem("date-format", value);
        setDateFormatState(value);
    }, []);

    const setTimezone = useCallback((value: string) => {
        localStorage.setItem("timezone", value);
        setTimezoneState(value);
    }, []);

    const refreshUsers = useCallback(async () => {
        const data = await TauriApi.GetCache();
        const list = Object.entries(data).map(([, value]) => ({...value})) as Users;
        setUsers(list);
    }, []);

    // The session token lives only in the Rust backend; the webview holds just
    // the user profile and status. Nothing sensitive touches localStorage.
    const completeLogin = useCallback((user: UserLogged) => {
        setUserLogged(user);
        setSessionStatus("authenticated");
    }, []);

    const logout = useCallback(() => {
        TauriApi.SignOut().catch(console.error);
        setUserLogged({});
        setSessionStatus("guest");
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const storedTheme = readStorage("theme", "midnight") as ThemeId;
        setTheme(storedTheme);
        setHourFormatState(readStorage("hour-format", "HH:MM") as "HH:MM" | "HH:MM:SS");
        setDateFormatState(readStorage("date-format", "24") as "12" | "24");
        setTimezoneState(readStorage("timezone", "America/Sao_Paulo"));
        setWorkHours(loadWorkHours());

        // Read work hours from DB (canonical); localStorage is the fast initial fallback.
        void TauriApi.GetWorkHours().then((dbValues) => {
            if (dbValues) setWorkHours(dbValues);
        });

        void refreshUsers();
        void TauriApi.GetAppVersion().then(setVersion);

        // Ask the backend whether it still holds a valid session (survives
        // webview reloads; cleared on full app restart — re-login required).
        TauriApi.RestoreSession()
            .then((user) => {
                setUserLogged(user);
                setSessionStatus("authenticated");
            })
            .catch(() => {
                setUserLogged({});
                setSessionStatus("guest");
            });
    }, [refreshUsers, setTheme]);

    useEffect(() => {
        const updateClock = () => {
            const date = new Date().toLocaleString(navigator.language, {
                hour: "numeric",
                minute: "numeric",
                second: hourFormat === "HH:MM:SS" ? "numeric" : undefined,
                hour12: dateFormat === "12",
                timeZone: timezone || "America/Sao_Paulo",
            });
            setClock(date);
        };
        updateClock();
        const id = setInterval(updateClock, 1000);
        return () => clearInterval(id);
    }, [hourFormat, dateFormat, timezone]);

    useEffect(() => {
        const checkReader = () => {
            TauriApi.ReaderStatus()
                .then((s) => setReaderConnected(s.connected))
                .catch(() => setReaderConnected(false));
        };
        checkReader();
        const id = setInterval(checkReader, 15000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        localStorage.setItem("HorarioEntrada", workHours.entry);
        localStorage.setItem("HorarioSaida", workHours.exit);
        localStorage.setItem("HorarioSaidaFDS", workHours.exitWeekend);
        localStorage.setItem("MinutosTolerancia", String(workHours.toleranceMinutes));
        void TauriApi.SaveWorkHours(workHours).catch(() => {});
    }, [workHours]);

    const value = useMemo(
        () => ({
            userLogged,
            setUserLogged,
            sessionStatus,
            completeLogin,
            logout,
            users,
            setUsers,
            version,
            theme,
            setTheme,
            hourFormat,
            setHourFormat,
            dateFormat,
            setDateFormat,
            timezone,
            setTimezone,
            clock,
            workHours,
            setWorkHours,
            readerConnected,
            refreshUsers,
        }),
        [
            userLogged,
            sessionStatus,
            completeLogin,
            logout,
            users,
            version,
            theme,
            setTheme,
            hourFormat,
            setHourFormat,
            dateFormat,
            setDateFormat,
            timezone,
            setTimezone,
            clock,
            workHours,
            readerConnected,
            refreshUsers,
        ]
    );

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error("useApp must be used within AppProvider");
    return ctx;
}
