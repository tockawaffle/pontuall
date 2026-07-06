import {ClockIcon} from "@/components/component/icons";
import {cn} from "@/lib/utils";

const WIZARD_STEPS = [
    {step: 0, label: "Boas-vindas"},
    {step: 1, label: "Horários"},
    {step: 2, label: "Banco de dados"},
    {step: 3, label: "Administrador"},
] as const;

type SetupSidebarProps = {
    currentStep: number;
};

export default function SetupSidebar({currentStep}: SetupSidebarProps) {
    return (
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-muted/30 px-5 py-6">
            <div className="mb-8 flex items-center gap-3">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/15 ring-1 ring-primary/20">
                    <ClockIcon className="size-5 text-primary"/>
                </div>
                <div>
                    <p className="font-semibold leading-tight">PontuAll</p>
                    <p className="text-xs text-muted-foreground">Configuração inicial</p>
                </div>
            </div>

            <nav aria-label="Etapas da configuração" className="flex flex-1 flex-col gap-3">
                {WIZARD_STEPS.map(({step, label}) => {
                    const isComplete = currentStep > step;
                    const isCurrent = currentStep === step;
                    const isUpcoming = currentStep < step;

                    return (
                        <div
                            key={step}
                            className={cn(
                                "flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors",
                                isCurrent && "bg-primary/10",
                            )}
                        >
                            <div
                                className={cn(
                                    "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors",
                                    isCurrent && "border-primary bg-primary text-primary-foreground",
                                    isComplete && "border-primary bg-primary/15 text-primary",
                                    isUpcoming && "border-border bg-background text-muted-foreground",
                                )}
                            >
                                {isComplete ? "✓" : step + 1}
                            </div>
                            <p className={cn(
                                "text-sm leading-tight",
                                isCurrent && "font-medium text-foreground",
                                isComplete && "text-foreground",
                                isUpcoming && "text-muted-foreground/60",
                            )}>
                                {label}
                            </p>
                        </div>
                    );
                })}
            </nav>

            <p className="mt-auto text-[11px] leading-relaxed text-muted-foreground">
                Você poderá alterar essas configurações depois nas preferências do aplicativo.
            </p>
        </aside>
    );
}
