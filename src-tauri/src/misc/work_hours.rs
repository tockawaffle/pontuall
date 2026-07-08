use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::error::DbError;
use crate::db::repo::{config, outbox};
use crate::db::DbState;

pub(crate) const WORK_HOURS_KEY: &str = "work_hours";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkHoursDto {
    pub entry: String,
    pub exit: String,
    pub exit_weekend: String,
    pub tolerance_minutes: u32,
}

impl Default for WorkHoursDto {
    fn default() -> Self {
        Self {
            entry: "08:00:00".into(),
            exit: "17:00:00".into(),
            exit_weekend: "12:00:00".into(),
            tolerance_minutes: 10,
        }
    }
}

pub(crate) async fn get_work_hours(db: &DbState) -> Option<WorkHoursDto> {
    let raw = config::get_local(&db.lite, WORK_HOURS_KEY).await.ok()??;
    serde_json::from_str(&raw).ok()
}

pub(crate) async fn save_work_hours(db: &DbState, cfg: &WorkHoursDto) -> Result<(), DbError> {
    let raw = serde_json::to_string(cfg)
        .map_err(|e| DbError::InvalidInput(format!("could not serialize work hours: {e}")))?;

    config::set_local(&db.lite, WORK_HOURS_KEY, &raw).await?;

    #[derive(Serialize)]
    struct OutboxPayload<'a> {
        key: &'a str,
        value: &'a str,
    }
    outbox::enqueue(
        &db.lite,
        "upsert_app_config",
        &OutboxPayload { key: WORK_HOURS_KEY, value: &raw },
    )
    .await?;

    if let Some(pg) = db.pg_if_online().await {
        let _ = config::upsert_pg(&pg, WORK_HOURS_KEY, &raw).await;
    }

    Ok(())
}

#[tauri::command]
pub(crate) async fn get_work_hours_cmd(
    db: State<'_, DbState>,
) -> Result<Option<WorkHoursDto>, DbError> {
    Ok(get_work_hours(&db).await)
}

#[tauri::command]
pub(crate) async fn save_work_hours_cmd(
    db: State<'_, DbState>,
    entry: String,
    exit: String,
    exit_weekend: String,
    tolerance_minutes: u32,
) -> Result<(), DbError> {
    let cfg = WorkHoursDto { entry, exit, exit_weekend, tolerance_minutes };
    save_work_hours(&db, &cfg).await
}
