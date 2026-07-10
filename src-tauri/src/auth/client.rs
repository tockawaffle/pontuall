use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auth::error::AuthError;
use crate::auth::{AuthState, UserLoggedDto};

#[derive(Debug, Deserialize)]
pub(crate) struct AuthUser {
    pub id: String,
    #[allow(dead_code)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthUserDto {
    pub id: String,
    pub name: String,
    pub email: String,
    pub role: Option<String>,
    pub banned: Option<bool>,
    pub created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    token: Option<String>,
    user: Option<AuthUser>,
}

#[derive(Debug, Deserialize)]
struct SessionResponse {
    user: Option<AuthUserDto>,
}

#[derive(Debug, Deserialize)]
struct ListUsersResponse {
    users: Vec<AuthUserDto>,
    total: u64,
}

#[derive(Debug, Deserialize)]
struct CreateUserResponse {
    user: AuthUserDto,
}

impl AuthState {
    pub(crate) async fn base_url(&self) -> Result<String, AuthError> {
        let port = self.port.read().await.ok_or_else(|| {
            AuthError::SidecarUnavailable("serviço de autenticação não iniciado".into())
        })?;
        Ok(format!("http://127.0.0.1:{port}"))
    }

    fn request(
        &self,
        method: reqwest::Method,
        url: String,
        bearer: Option<&str>,
    ) -> reqwest::RequestBuilder {
        let mut builder = self
            .client
            .request(method, url)
            .header("x-pontuall-key", &self.shared_key);
        if let Some(token) = bearer {
            builder = builder.bearer_auth(token);
        }
        builder
    }

    /// Returns `(session_token, auth_user_id)`.
    pub(crate) async fn sign_in_email(
        &self,
        email: &str,
        password: &str,
    ) -> Result<(String, String), AuthError> {
        let url = format!("{}/api/auth/sign-in/email", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({ "email": email, "password": password }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            || response.status() == reqwest::StatusCode::FORBIDDEN
            || response.status() == reqwest::StatusCode::BAD_REQUEST
        {
            return Err(AuthError::InvalidCredentials);
        }
        let response = response.error_for_status()?;

        // The bearer plugin also exposes the token via the set-auth-token
        // header; the body carries it on current versions.
        let header_token = response
            .headers()
            .get("set-auth-token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);

        let body: TokenResponse = response.json().await?;
        let token = body
            .token
            .or(header_token)
            .ok_or_else(|| AuthError::Internal("resposta de login sem token".into()))?;
        let user = body
            .user
            .ok_or_else(|| AuthError::Internal("resposta de login sem usuário".into()))?;

        Ok((token, user.id))
    }

    /// Returns `(session_token, auth_user_id)` for a newly created account.
    pub(crate) async fn sign_up_email(
        &self,
        name: &str,
        email: &str,
        password: &str,
    ) -> Result<(String, String), AuthError> {
        let url = format!("{}/api/auth/sign-up/email", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({ "name": name, "email": email, "password": password }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNPROCESSABLE_ENTITY {
            return Err(AuthError::Conflict("e-mail já cadastrado".into()));
        }
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Internal(format!(
                "falha ao criar conta ({status}): {body}"
            )));
        }

        let body: TokenResponse = response.json().await?;
        let user = body
            .user
            .ok_or_else(|| AuthError::Internal("resposta de cadastro sem usuário".into()))?;
        Ok((body.token.unwrap_or_default(), user.id))
    }

    pub(crate) async fn sign_out(&self, token: &str) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/sign-out", self.base_url().await?);
        self.request(reqwest::Method::POST, url, Some(token))
            .json(&json!({}))
            .send()
            .await?;
        Ok(())
    }

    pub(crate) async fn change_password(
        &self,
        token: &str,
        current: &str,
        new: &str,
    ) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/change-password", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({
                "currentPassword": current,
                "newPassword": new,
                "revokeOtherSessions": false,
            }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::BAD_REQUEST
            || response.status() == reqwest::StatusCode::UNAUTHORIZED
        {
            return Err(AuthError::InvalidCredentials);
        }
        response.error_for_status()?;
        Ok(())
    }

    /// Returns the Better Auth user attached to a bearer session (includes role).
    pub(crate) async fn get_session_user(&self, token: &str) -> Result<AuthUserDto, AuthError> {
        let url = format!("{}/api/auth/get-session", self.base_url().await?);
        let response = self
            .request(reqwest::Method::GET, url, Some(token))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        let response = response.error_for_status()?;

        let body: Option<SessionResponse> = response.json().await.unwrap_or(None);
        body.and_then(|s| s.user)
            .ok_or(AuthError::InvalidSession)
    }

    /// Bootstrap-only: sets Better Auth role to admin without an admin session.
    pub(crate) async fn promote_auth_admin(&self, user_id: &str) -> Result<(), AuthError> {
        let url = format!("{}/internal/promote-auth-admin", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({ "userId": user_id }))
            .send()
            .await?
            .error_for_status()?;
        let _ = response;
        Ok(())
    }

    pub(crate) async fn set_user_role_internal(
        &self,
        user_id: &str,
        role: &str,
        actor: Option<&UserLoggedDto>,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/set-user-role", self.base_url().await?);
        let mut body = json!({ "userId": user_id, "role": role });
        if let Some(actor) = actor {
            body["actorId"] = json!(actor.id);
            body["actorName"] = json!(actor.name);
        }
        self.request(reqwest::Method::POST, url, None)
            .json(&body)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub(crate) async fn admin_list_users(
        &self,
        token: &str,
        limit: u32,
        offset: u32,
    ) -> Result<(Vec<AuthUserDto>, u64), AuthError> {
        let url = format!(
            "{}/api/auth/admin/list-users?limit={limit}&offset={offset}",
            self.base_url().await?
        );
        let response = self
            .request(reqwest::Method::GET, url, Some(token))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        let response = response.error_for_status()?;
        let body: ListUsersResponse = response.json().await?;
        Ok((body.users, body.total))
    }

    pub(crate) async fn admin_create_user(
        &self,
        token: &str,
        name: &str,
        email: &str,
        password: &str,
        role: &str,
    ) -> Result<String, AuthError> {
        let url = format!("{}/api/auth/admin/create-user", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({
                "name": name,
                "email": email,
                "password": password,
                "role": role,
            }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        if response.status() == reqwest::StatusCode::BAD_REQUEST {
            return Err(AuthError::Conflict("e-mail já cadastrado".into()));
        }
        let response = response.error_for_status()?;
        let body: CreateUserResponse = response.json().await?;
        Ok(body.user.id)
    }

    /// Emails the user a one-time link to set their own password. The link
    /// uses the admin-configured public URL when set (Settings → Avançado),
    /// otherwise the sidecar's auto-detected LAN address.
    pub(crate) async fn send_password_setup(
        &self,
        email: &str,
        smtp: &crate::misc::smtp::SmtpConfigDto,
        public_url: Option<&str>,
        actor: Option<&UserLoggedDto>,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/password-setup/send", self.base_url().await?);
        let mut body = json!({ "email": email, "smtp": smtp });
        if let Some(public_url) = public_url {
            body["publicBaseUrl"] = json!(public_url);
        }
        if let Some(actor) = actor {
            body["actorId"] = json!(actor.id);
            body["actorName"] = json!(actor.name);
        }
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Internal(if body.is_empty() {
                "falha ao enviar o link de definição de senha".into()
            } else {
                body
            }));
        }
        Ok(())
    }

    pub(crate) async fn admin_ban_user(
        &self,
        token: &str,
        user_id: &str,
        reason: Option<&str>,
    ) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/admin/ban-user", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({
                "userId": user_id,
                "banReason": reason.unwrap_or("Conta suspensa pelo administrador"),
            }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        response.error_for_status()?;
        Ok(())
    }

    pub(crate) async fn admin_unban_user(&self, token: &str, user_id: &str) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/admin/unban-user", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({ "userId": user_id }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        response.error_for_status()?;
        Ok(())
    }

    pub(crate) async fn admin_remove_user(&self, token: &str, user_id: &str) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/admin/remove-user", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({ "userId": user_id }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        response.error_for_status()?;
        Ok(())
    }

    pub(crate) async fn admin_set_role(
        &self,
        token: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), AuthError> {
        let url = format!("{}/api/auth/admin/set-role", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, Some(token))
            .json(&json!({ "userId": user_id, "role": role }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::FORBIDDEN {
            return Err(AuthError::Forbidden);
        }
        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        response.error_for_status()?;
        Ok(())
    }

    /// Checks Better Auth permissions for the bearer session or a specific user.
    pub(crate) async fn has_permission(
        &self,
        bearer: Option<&str>,
        user_id: Option<&str>,
        permissions: serde_json::Value,
    ) -> Result<bool, AuthError> {
        // Public route requires a bearer session when custom headers are present.
        // Use the internal route for employee-id checks from Rust.
        let url = if bearer.is_some() {
            format!("{}/api/auth/admin/has-permission", self.base_url().await?)
        } else if user_id.is_some() {
            format!("{}/internal/has-permission", self.base_url().await?)
        } else {
            return Err(AuthError::Internal(
                "has_permission requires bearer or user_id".into(),
            ));
        };

        let mut body = json!({ "permissions": permissions });
        if let Some(uid) = user_id {
            body["userId"] = json!(uid);
        }

        let response = self
            .request(reqwest::Method::POST, url, bearer)
            .json(&body)
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            return Err(AuthError::InvalidSession);
        }
        let response = response.error_for_status()?;

        #[derive(Deserialize)]
        struct HasPermissionResponse {
            success: bool,
        }

        let body: HasPermissionResponse = response.json().await?;
        Ok(body.success)
    }

    pub(crate) async fn send_punch_otp(
        &self,
        auth_user_id: &str,
        email: &str,
        employee_name: &str,
        smtp: &crate::misc::smtp::SmtpConfigDto,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/punch-otp/send", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({
                "authUserId": auth_user_id,
                "email": email,
                "employeeName": employee_name,
                "smtp": smtp,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Internal(if body.is_empty() {
                "falha ao enviar código por e-mail".into()
            } else {
                body
            }));
        }
        Ok(())
    }

    pub(crate) async fn verify_punch_otp(
        &self,
        auth_user_id: &str,
        code: &str,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/punch-otp/verify", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({
                "authUserId": auth_user_id,
                "code": code,
            }))
            .send()
            .await?;

        if response.status() == reqwest::StatusCode::UNAUTHORIZED {
            #[derive(Deserialize)]
            struct VerifyFail {
                reason: Option<String>,
            }
            let body: VerifyFail = response.json().await.unwrap_or(VerifyFail { reason: None });
            let message = match body.reason.as_deref() {
                Some("expired") => "código expirado — solicite um novo",
                Some("locked") => "muitas tentativas — aguarde e solicite um novo código",
                Some("missing") => "nenhum código pendente — solicite um novo",
                _ => "código inválido",
            };
            return Err(AuthError::Internal(message.to_string()));
        }

        response.error_for_status()?;
        Ok(())
    }

    /// Audit trail page (raw JSON from the sidecar, passed to the frontend).
    pub(crate) async fn audit_list(
        &self,
        limit: u32,
        offset: u32,
    ) -> Result<serde_json::Value, AuthError> {
        let url = format!(
            "{}/internal/audit/list?limit={limit}&offset={offset}",
            self.base_url().await?
        );
        let response = self
            .request(reqwest::Method::GET, url, None)
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    /// Recomputes the audit hash chain; any break means tampering.
    pub(crate) async fn audit_verify(&self) -> Result<serde_json::Value, AuthError> {
        let url = format!("{}/internal/audit/verify", self.base_url().await?);
        let response = self
            .request(reqwest::Method::GET, url, None)
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }

    /// All Better Auth user roles keyed by user id (internal route).
    pub(crate) async fn fetch_user_roles(
        &self,
    ) -> Result<std::collections::HashMap<String, String>, AuthError> {
        let url = format!("{}/internal/user-roles", self.base_url().await?);
        let response = self
            .request(reqwest::Method::GET, url, None)
            .send()
            .await?;
        let response = response.error_for_status()?;

        #[derive(Deserialize)]
        struct UserRolesResponse {
            roles: std::collections::HashMap<String, String>,
        }

        let body: UserRolesResponse = response.json().await?;
        Ok(body.roles)
    }

    /// E-mails the terminated employee a copy of their data (LGPD Art. 18).
    pub(crate) async fn send_data_export(
        &self,
        to: &str,
        export: &serde_json::Value,
        smtp: &crate::misc::smtp::SmtpConfigDto,
        actor: &UserLoggedDto,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/data-export/send", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({
                "to": to,
                "smtp": smtp,
                "export": export,
                "actorId": actor.id,
                "actorName": actor.name,
            }))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Internal(if body.is_empty() {
                "falha ao enviar os dados por e-mail".into()
            } else {
                body
            }));
        }
        Ok(())
    }

    /// Pushes the work hours schedule to the sidecar so the missed-punch
    /// notification scheduler knows when to fire checks each day.
    pub(crate) async fn push_work_hours(
        &self,
        hours: &crate::misc::work_hours::WorkHoursDto,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/work-hours/push", self.base_url().await?);
        self.request(reqwest::Method::POST, url, None)
            .json(&json!({ "workHours": hours }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    /// Pushes the stored SMTP config to the sidecar so self-service password
    /// recovery (initiated from the portal) works without an admin action first.
    pub(crate) async fn push_smtp_config(
        &self,
        smtp: &crate::misc::smtp::SmtpConfigDto,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/smtp/push", self.base_url().await?);
        self.request(reqwest::Method::POST, url, None)
            .json(&json!({ "smtp": smtp }))
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub(crate) async fn test_smtp(
        &self,
        smtp: &crate::misc::smtp::SmtpConfigDto,
        to: &str,
    ) -> Result<(), AuthError> {
        let url = format!("{}/internal/smtp/test", self.base_url().await?);
        let response = self
            .request(reqwest::Method::POST, url, None)
            .json(&json!({ "smtp": smtp, "to": to }))
            .send()
            .await?;

        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(AuthError::Internal(if body.is_empty() {
                "falha ao enviar e-mail de teste".into()
            } else {
                body
            }));
        }
        Ok(())
    }
}
