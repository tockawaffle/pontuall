type SetupStepHeaderProps = {
    title: string;
    description: string;
};

export default function SetupStepHeader({title, description}: SetupStepHeaderProps) {
    return (
        <header className="mb-8 space-y-2 border-b border-border pb-6">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </header>
    );
}
