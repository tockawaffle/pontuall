export default class TauriApi {
    /**
     * ------------------------------------------------------------------------------------------
     * These commands are used to interact with the card reader.
     * Things like reading the card, connecting to the reader, etc.
     * ------------------------------------------------------------------------------------------
     */

    public static async ReaderStatus(): Promise<{ connected: boolean, name: string | null }> {
        return this.command("reader_status", {});
    }

    public static async AwaitTap(): Promise<CardTapResult> {
        return this.command<CardTapResult>("card_await_tap", {});
    }

    public static async CancelCard(): Promise<void> {
        return this.command<void>("card_cancel", {});
    }

    public static async GenerateUserId(): Promise<string> {
        return this.command<string>("gen_id", {});
    }

    /** Provisions a card. Pass `force` to reformat a non-blank/foreign card. */
    public static async ProvisionCard(employeeId: string, force = false): Promise<CardInfo> {
        return this.command<CardInfo>("provision_card", {employeeId, force});
    }

    /**
     * Provisions a replacement card and blocks the employee's previous cards.
     * Pass `force` to reformat a non-blank/foreign card.
     */
    public static async ReprovisionCard(employeeId: string, force = false): Promise<CardInfo> {
        return this.command<CardInfo>("reprovision_card", {employeeId, force});
    }

    public static async UnprovisionCard(cardId: string): Promise<void> {
        return this.command<void>("unprovision_card", {cardId});
    }

    public static async SetCardStatus(cardId: string, status: string): Promise<void> {
        return this.command<void>("set_card_status", {cardId, status});
    }

    public static async CardDiagnostic(): Promise<{ uid: string, magic_ok: boolean, authenticated: boolean }> {
        return this.command("card_diagnostic", {});
    }

    public static async InsertNewUser(
        id: string,
        name: string,
        email: string,
        role: string,
        lunch_time: string,
        phone: string,
    ) {
        return this.command<boolean>("insert_new_user", {
            id,
            name,
            email,
            role,
            lunchTime: lunch_time,
            phone
        });
    }

    public static async UpdateEmployee(
        employeeId: string,
        name: string,
        email: string,
        role: string,
        lunchTime: string,
        phone: string,
        accessLevel: "employee" | "supervisor" | "administrator",
    ) {
        return this.command<boolean>("update_employee", {
            employeeId,
            name,
            email: email.trim() === "" ? null : email,
            role,
            lunchTime: lunchTime.trim() === "" ? null : lunchTime,
            phone: phone.trim() === "" ? null : phone,
            accessLevel,
        });
    }

    public static async UpdateUser(
        id: string,
        day: string,
        keyToUpdate: "ClockIn" | "ClockLunchOut" | "ClockLunchReturn" | "ClockOut",
        value: string,
        punchSource: "card" | "manual_otp" = "card",
    ) {
        return this.command<boolean>("update_cache_hour_data", {
            id,
            day,
            keyToUpdate,
            value,
            punchSource,
        });
    }

    public static async DeleteTimeEntryDay(employeeId: string, day: string) {
        return this.command<boolean>("delete_time_entry_day", {employeeId, day});
    }

    /**
     * Terminates an employee: e-mails them a copy of their data and punch
     * history (LGPD Art. 18), blocks their cards and removes their login.
     * `exportSent` is false when there is no e-mail or SMTP configured.
     */
    public static async TerminateEmployee(employeeId: string) {
        return this.command<{ exportSent: boolean }>("employee_terminate", {employeeId});
    }

    public static async UpdateCache() {
        return this.command<void>("get_users_and_cache", {});
    }

    public static async LoginUser(
        email: string,
        password: string,
    ) {
        try {
            const user = await this.command<UserLogged>("auth_sign_in", {
                email,
                password
            });

            return {userLogged: user, message: "", code: "ok"};
        } catch (e: any) {
            return {
                userLogged: {} as Record<string, never>,
                message: e?.message ?? String(e),
                code: e?.code ?? "error"
            }
        }
    }

    /** Restores the user for the backend-held session, or throws if none. */
    public static async RestoreSession() {
        return this.command<UserLogged>("auth_current_user", {});
    }

    public static async SignOut() {
        return this.command<void>("auth_sign_out", {});
    }

    public static async ChangePassword(currentPassword: string, newPassword: string) {
        return this.command<void>("auth_change_password", {
            currentPassword,
            newPassword
        });
    }

    public static async HasAdmin() {
        return this.command<boolean>("auth_has_admin", {});
    }

    public static async BootstrapAdmin(name: string, email: string, password: string, role: string) {
        return this.command<UserLogged>("auth_bootstrap_admin", {name, email, password, role});
    }

    /** Creates the account and e-mails the employee a link to set their own password. */
    public static async CreateAccount(
        employeeId: string,
        email: string,
        accessLevel: "employee" | "supervisor" | "administrator" = "employee",
    ) {
        return this.command<void>("auth_create_account", {
            employeeId,
            email,
            accessLevel,
        });
    }

    public static async ListAuthUsers(limit = 100, offset = 0) {
        return this.command<AuthUserListResult>("auth_admin_list_users", {
            limit,
            offset
        });
    }

    /** E-mails the account holder a one-time link to redefine their password. */
    public static async SendPasswordReset(email: string) {
        return this.command<void>("auth_admin_send_password_reset", {
            email
        });
    }

    public static async SetAuthUserRole(userId: string, role: "employee" | "supervisor" | "administrator") {
        return this.command<void>("auth_admin_set_role", {
            userId,
            role
        });
    }

    public static async BanAuthUser(userId: string, reason?: string) {
        return this.command<void>("auth_admin_ban_user", {
            userId,
            reason
        });
    }

    public static async UnbanAuthUser(userId: string) {
        return this.command<void>("auth_admin_unban_user", {
            userId
        });
    }

    public static async RemoveAuthUser(userId: string) {
        return this.command<void>("auth_admin_remove_user", {
            userId
        });
    }

    public static async ListAuditLog(limit = 50, offset = 0) {
        return this.command<AuditListResult>("auth_audit_list", {
            limit,
            offset
        });
    }

    public static async VerifyAuditLog() {
        return this.command<AuditVerifyResult>("auth_audit_verify", {});
    }

    public static async GetManualPunchStatus() {
        return this.command<{
            enabled: boolean;
            smtpConfigured: boolean;
            available: boolean;
        }>("get_manual_punch_status", {});
    }

    public static async SetManualPunchEnabled(enabled: boolean) {
        return this.command<boolean>("set_manual_punch_enabled_cmd", {
            enabled,
        });
    }

    public static async GetSmtpConfig() {
        return this.command<{
            host: string;
            port: number;
            secure: boolean;
            user: string;
            from: string;
            configured: boolean;
        } | null>("get_smtp_config_cmd", {});
    }

    public static async SetSmtpConfig(
        config: {
            host: string;
            port: number;
            secure: boolean;
            user: string;
            pass: string;
            from: string;
        },
    ) {
        return this.command<boolean>("set_smtp_config_cmd", {
            ...config,
        });
    }

    public static async TestSmtpConfig(to: string) {
        return this.command<boolean>("test_smtp_config_cmd", {to});
    }

    public static async GetAdvancedConfig() {
        return this.command<{
            port: number;
            publicUrl: string;
        }>("get_advanced_config_cmd", {});
    }

    public static async SetAdvancedConfig(port: number, publicUrl: string) {
        return this.command<boolean>("set_advanced_config_cmd", {
            port,
            publicUrl,
        });
    }

    public static async GetWorkHours() {
        return this.command<{
            entry: string;
            exit: string;
            exitWeekend: string;
            toleranceMinutes: number;
        } | null>("get_work_hours_cmd", {});
    }

    public static async SaveWorkHours(config: {
        entry: string;
        exit: string;
        exitWeekend: string;
        toleranceMinutes: number;
    }) {
        return this.command<void>("save_work_hours_cmd", {
            entry: config.entry,
            exit: config.exit,
            exitWeekend: config.exitWeekend,
            toleranceMinutes: config.toleranceMinutes,
        });
    }

    public static async RequestPunchOtp(email: string) {
        return this.command<boolean>("request_punch_otp", {email});
    }

    public static async VerifyPunchOtp(email: string, code: string) {
        return this.command<string>("verify_punch_otp", {email, code});
    }

    public static async StartBackendServices() {
        return this.command<void>("start_backend_services", {});
    }

    public static async GetSessionCapabilities(): Promise<SessionCapabilities> {
        return this.command<SessionCapabilities>("auth_session_capabilities", {});
    }

    public static async SessionHasPermission(
        permissions: Record<string, string[]>
    ): Promise<boolean> {
        return this.command<boolean>("auth_session_has_permission", {
            permissions,
        });
    }

    public static async CanAccessAdmin(): Promise<boolean> {
        try {
            const caps = await this.GetSessionCapabilities();
            return caps.hierarchyManage || caps.punchWriteOthers;
        } catch {
            return false;
        }
    }

    /**
     * ------------------------------------------------------------------------------------------
     *
     */

    public static async CreateReport(
        dateStart: string,
        dateEnd: string,
        entryTime: string,
        exitTime: string,
        tolerance: string
    ) {
        const users = await this.GetCache();
        return this.command<void>("create_excel_relatory", {
            dateStart,
            dateEnd,
            entryTime,
            exitTime,
            tolerance,
            users
        });
    }

    /**
     * ------------------------------------------------------------------------------------------
     * These commands are used to get metadata from the app.
     * Things like the app version, name, etc.
     * ------------------------------------------------------------------------------------------
     */

    public static async GetAppVersion(): Promise<{
        version: string,
        versionName: string
    }> {
        const {getVersion} = await import("@tauri-apps/api/app");
        const version = await getVersion();
        const versionName = await this.command<string>("version_name", {version});

        return {
            version,
            versionName
        }
    }

    /**
     * ------------------------------------------------------------------------------------------
     * From here on you'll find commands for the Setup,
     * these commands should only be called on the setup page or in really specific conditions,
     * and because of that you SHOULD NOT call these commands in the main app.
     * ------------------------------------------------------------------------------------------
     */


    // Get cache from AppData, this can be called since it does not mess with the app's state.
    public static async GetCache() {
        return this.command<CachedUsers>("get_cache", {});
    }

    // This command is called ONCE at the splashscreen window to set up the app.
    public static async SetupApp(): Promise<boolean> {
        return this.command<boolean>("complete_setup", {task: "finish_frontend"});
    }

    public static async SetupDatabase(appName: string, uri?: string) {
        return this.command<boolean>("insert_db_config", {uri, appName});
    }

    /** Returns a warning message when the connection does not force TLS. */
    public static async TestDatabase(uri: string) {
        return this.command<string | null>("test_db_connection", {uri});
    }

    // Event listener for each window
    public static async ListenEvent(event: string, callback: (event: any) => void) {
        const {listen} = await import('@tauri-apps/api/event');
        return await listen(event, callback);
    }

    private static async command<T>(command: string, args: any): Promise<T> {
        const {invoke} = await import('@tauri-apps/api/core');
        return invoke(command, args);
    }
}
