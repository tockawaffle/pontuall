import React from "react";
import AppShell from "@/components/main/AppShell";
import SettingsPage from "@/components/main/Settings";

export default function SettingsRoute() {
    return (
        <AppShell>
            <SettingsPage/>
        </AppShell>
    );
}
