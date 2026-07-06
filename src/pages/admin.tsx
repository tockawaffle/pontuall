import React from "react";
import AppShell from "@/components/main/AppShell";
import AdminPage from "@/components/main/Admin";

export default function AdminRoute() {
    return (
        <AppShell>
            <AdminPage/>
        </AppShell>
    );
}
