import React from "react";
import {ClockIcon} from "@/components/component/icons";
import SetupSidebar from "@/components/splashscreen/SetupSidebar";
import {cn} from "@/lib/utils";

type SetupShellProps = {
    setupStep: number;
    children: React.ReactNode;
    className?: string;
};

export default function SetupShell({setupStep, children, className}: SetupShellProps) {
    return (
        <div className="flex h-dvh min-h-0 w-full overflow-hidden bg-background">
            <SetupSidebar currentStep={setupStep}/>
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className={cn("flex-1 overflow-y-auto px-10 py-8", className)}>
                    <div className="mx-auto w-full max-w-xl">
                        {children}
                    </div>
                </div>
            </main>
        </div>
    );
}

export function SetupLoadingShell({children}: { children: React.ReactNode }) {
    return (
        <div className="flex h-dvh w-full flex-col items-center justify-center bg-background px-8">
            <div className="mb-8 flex flex-col items-center gap-3">
                <div className="rounded-2xl bg-primary/10 p-4 ring-1 ring-primary/20">
                    <ClockIcon className="size-12 text-primary"/>
                </div>
                <span className="text-lg font-semibold tracking-tight">PontuAll</span>
            </div>
            <div className="w-full max-w-sm space-y-6">
                {children}
            </div>
        </div>
    );
}
