use std::str::FromStr;

use serde_json::json;

/// Permission checks map to Better Auth access-control payloads.
pub(crate) enum PermissionAction {
    ReadSelf,
    ReadOthers,
    WriteSelf,
    WriteOthers,
    DeleteSelf,
    DeleteOthers,
    EditHours,
    EditHierarchy,
    CreateReports,
    SuperUser,
    Supervisor,
    Administrator,
    ProvisionCard,
}

impl FromStr for PermissionAction {
    type Err = ();

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "ReadSelf" => Ok(PermissionAction::ReadSelf),
            "ReadOthers" => Ok(PermissionAction::ReadOthers),
            "WriteSelf" => Ok(PermissionAction::WriteSelf),
            "WriteOthers" => Ok(PermissionAction::WriteOthers),
            "DeleteSelf" => Ok(PermissionAction::DeleteSelf),
            "DeleteOthers" => Ok(PermissionAction::DeleteOthers),
            "EditHours" => Ok(PermissionAction::EditHours),
            "EditHierarchy" => Ok(PermissionAction::EditHierarchy),
            "CreateReports" => Ok(PermissionAction::CreateReports),
            "SuperUser" => Ok(PermissionAction::SuperUser),
            "Supervisor" => Ok(PermissionAction::Supervisor),
            "Administrator" => Ok(PermissionAction::Administrator),
            _ => Err(()),
        }
    }
}

/// Better Auth permission payload for `POST /admin/has-permission`.
pub(crate) fn action_to_ba_permissions(action: PermissionAction) -> serde_json::Value {
    use PermissionAction::*;

    match action {
        ReadSelf => json!({ "punch": ["read-self"] }),
        ReadOthers => json!({ "punch": ["read-others"] }),
        WriteSelf => json!({ "punch": ["write-self"] }),
        WriteOthers => json!({ "punch": ["write-others"] }),
        DeleteSelf => json!({ "punch": ["delete-self"] }),
        DeleteOthers => json!({ "punch": ["delete-others"] }),
        EditHours => json!({ "hours": ["edit"] }),
        EditHierarchy => json!({ "hierarchy": ["manage"] }),
        CreateReports => json!({ "reports": ["create"] }),
        SuperUser => json!({ "card": ["master-key"] }),
        Supervisor => json!({
            "punch": ["read-others", "write-others"],
            "hours": ["edit"],
            "reports": ["create"],
            "card": ["provision"]
        }),
        Administrator => json!({ "hierarchy": ["manage"] }),
        ProvisionCard => json!({ "card": ["provision"] }),
    }
}
