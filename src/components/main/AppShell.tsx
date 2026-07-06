import React from "react";
import Header from "@/components/main/Header";

export default function AppShell({children}: { children: React.ReactNode }) {
    return (
        <div className="flex flex-col min-h-screen bg-background">
            <Header/>
            <main className="flex-1">{children}</main>
        </div>
    );
}