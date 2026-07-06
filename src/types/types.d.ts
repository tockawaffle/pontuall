declare global {
    type HourData = {
        clock_in: string,
        lunch_break_out: string,
        lunch_break_return: string,
        clocked_out: string,
        total_hours: string
    }

    interface IUsers {
        id: string,
        name: string,
        email?: string,
        image: string,
        role: string,
        hour_data: {
            [key: string]: HourData
        }
        status?: string,
        lunch_time?: string,
        phone?: string,
        access_role?: string | null,
        auth_user_id?: string | null,
    }

    interface CachedUsers {
        [name: string]: IUsers
    }

    type Users = IUsers[]

    type UserLogged = {
        id: string,
        name: string,
        image: string | null,
        /** Job title from the employee record. */
        role: string,
        /** Better Auth role: employee | supervisor | administrator */
        accessRole: string,
    }

    type SessionCapabilities = {
        punchReadSelf: boolean,
        punchReadOthers: boolean,
        punchWriteSelf: boolean,
        punchWriteOthers: boolean,
        hoursEdit: boolean,
        hierarchyManage: boolean,
        reportsCreate: boolean,
        cardProvision: boolean,
    }

    type CardTapResult =
        | { outcome: "ok", employee_id: string }
        | { outcome: "unknown_card", uid: string }
        | { outcome: "blocked", employee_id: string }
        | { outcome: "clone_detected", employee_id: string, uid: string }

    type CardInfo = {
        id: string,
        uid: string,
        employee_id: string,
        status: string
    }

    type Pages = "home" | "configuration" | "profile" | "about" | "help" | "admin"

    type IDialogMessage = {
        message: string,
        type: string,
        showDefaultCancel?: boolean
        release?: string
    }

    type AuthAccessUser = {
        id: string,
        name: string,
        email: string,
        role?: string | null,
        banned?: boolean | null,
        createdAt?: string | null,
    }

    type AuthUserListResult = {
        users: AuthAccessUser[],
        total: number,
    }

    type AuditEntry = {
        id: string,
        actor_id: string | null,
        actor_name: string | null,
        actor_type: string,
        action: string,
        resource: string | null,
        success: boolean,
        ip_address: string | null,
        created_at: string,
    }

    type AuditListResult = {
        entries: AuditEntry[],
        total: number,
    }

    type AuditVerifyResult = {
        ok: boolean,
        total: number,
        brokenAtId: string | null,
    }
}

export {}