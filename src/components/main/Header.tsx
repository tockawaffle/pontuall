import Link from "next/link";
import {useRouter} from "next/router";
import {AlertLoop, ClockIcon, SettingsIcon} from "@/components/component/icons";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {Button} from "@/components/ui/button";
import {Avatar, AvatarFallback} from "@/components/ui/avatar";
import React, {useEffect, useState} from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {Label} from "@/components/ui/label";
import {Input} from "@/components/ui/input";
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";
import TauriApi from "@/lib/Tauri";
import {cn} from "@/lib/utils";
import {useApp} from "@/contexts/app-context";

const PAGE_LABELS: Record<string, string> = {
    "/settings": "Configurações",
    "/admin": "Administração",
};

export default function Header() {
    const router = useRouter();
    const {userLogged, completeLogin, logout, version, readerConnected, clock, sessionStatus} = useApp();

    const [loginError, setLoginError] = useState("");
    const [loginDialogOpen, setLoginDialogOpen] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const [loginInfo, setLoginInfo] = useState({email: "", password: ""});
    const [hasPermission, setHasPermission] = useState(false);

    const isHome = router.pathname === "/";
    const pageLabel = PAGE_LABELS[router.pathname];

    function handleLogout() {
        logout();
        void router.push("/");
    }

    async function handleLogin() {
        if (!loginInfo.email || !loginInfo.password) return;

        const {userLogged: loggedIn, message} = await TauriApi.LoginUser(
            loginInfo.email,
            loginInfo.password
        );

        if (Object.keys(loggedIn).length > 0) {
            completeLogin(loggedIn as UserLogged);
            setLoginDialogOpen(false);
            setLoginError("");
        } else {
            setLoginError(message);
        }
    }

    useEffect(() => {
        if (sessionStatus !== "authenticated") {
            setHasPermission(false);
            return;
        }

        TauriApi.CanAccessAdmin()
            .then(setHasPermission)
            .catch(() => setHasPermission(false));
    }, [sessionStatus]);

    useEffect(() => {
        TauriApi.ListenEvent("status:offline", (event) => {
            setIsOffline(event.payload as boolean);
        });
    }, []);

    return (
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b px-4 sm:px-6">
            {/* Brand — always returns to the primary job: punch */}
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    href="/"
                    className="flex items-center gap-2 font-semibold tracking-tight hover:opacity-90"
                >
                    <ClockIcon className="h-5 w-5 shrink-0 text-primary"/>
                    <span className="truncate">Pontuall</span>
                </Link>
                {!isHome && pageLabel && (
                    <>
                        <span className="text-muted-foreground/50 hidden sm:inline" aria-hidden>
                            /
                        </span>
                        <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                            {pageLabel}
                        </span>
                    </>
                )}
            </div>

            {/* Secondary pages: ambient clock — context, not navigation */}
            {!isHome && (
                <p className="hidden tabular-nums text-sm text-muted-foreground md:block">{clock}</p>
            )}

            {/* Operational status + account — never compete with the punch CTA on home */}
            <div className="flex items-center gap-2">
                {readerConnected !== null && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div
                                    className={cn(
                                        "flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium",
                                        readerConnected
                                            ? "bg-success/15 text-success"
                                            : "bg-warning/15 text-warning"
                                    )}
                                >
                                    <span
                                        className={cn(
                                            "size-1.5 rounded-full",
                                            readerConnected ? "bg-success" : "bg-warning animate-pulse"
                                        )}
                                    />
                                    <span className="sr-only sm:not-sr-only">
                                        {readerConnected ? "Leitor OK" : "Sem leitor"}
                                    </span>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                {readerConnected
                                    ? "Leitor NFC pronto"
                                    : "Conecte o leitor ACR122U ou verifique o Smart Card"}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                {isOffline && (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex size-8 items-center justify-center rounded-md bg-destructive/15">
                                    <AlertLoop color="currentColor" className="size-4 text-destructive"/>
                                </div>
                            </TooltipTrigger>
                            <TooltipContent side="bottom">
                                Sem conexão — registros serão sincronizados ao reconectar.
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )}

                {Object.keys(userLogged).length > 0 ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-9 rounded-full">
                                <Avatar className="size-8 border">
                                    <AvatarFallback className="text-xs">
                                        {(userLogged as UserLogged).name.charAt(0).toUpperCase()}
                                    </AvatarFallback>
                                </Avatar>
                                <span className="sr-only">Conta</span>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuLabel className="font-normal">
                                <p className="truncate text-sm font-medium">
                                    {(userLogged as UserLogged).name}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                    {(userLogged as UserLogged).role}
                                </p>
                            </DropdownMenuLabel>
                            <DropdownMenuSeparator/>
                            <DropdownMenuItem asChild>
                                <Link href="/settings?tab=account">Meu perfil</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleLogout}>Sair</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : (
                    <Dialog
                        open={loginDialogOpen}
                        onOpenChange={(open) => {
                            setLoginDialogOpen(open);
                            if (!open) setLoginError("");
                        }}
                    >
                        <DialogTrigger asChild>
                            <Button variant="outline" size="sm">
                                Entrar
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[400px]">
                            <DialogHeader>
                                <DialogTitle>Entrar</DialogTitle>
                                <DialogDescription>
                                    Acesso para supervisores e relatórios.
                                    {loginError && (
                                        <span className="mt-2 block text-destructive">{loginError}</span>
                                    )}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-2">
                                <div className="space-y-2">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={loginInfo.email}
                                        onChange={(e) =>
                                            setLoginInfo({...loginInfo, email: e.target.value})
                                        }
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="password">Senha</Label>
                                    <Input
                                        id="password"
                                        type="password"
                                        value={loginInfo.password}
                                        onChange={(e) =>
                                            setLoginInfo({...loginInfo, password: e.target.value})
                                        }
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={() => void handleLogin()}>Entrar</Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                )}

                {/* One secondary menu — config & admin live here, not in a top nav */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-9 rounded-full">
                            <SettingsIcon className="h-5 w-5"/>
                            <span className="sr-only">Mais opções</span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                        <DropdownMenuItem asChild>
                            <Link href="/settings">Configurações</Link>
                        </DropdownMenuItem>
                        {hasPermission && (
                            <DropdownMenuItem asChild>
                                <Link href="/admin">Administração</Link>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator/>
                        <DropdownMenuItem asChild>
                            <Link href="/settings?tab=system">Sobre o app</Link>
                        </DropdownMenuItem>
                        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            v{version.version || "—"}
                            {version.versionName ? ` · ${version.versionName}` : ""}
                        </DropdownMenuLabel>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </header>
    );
}
