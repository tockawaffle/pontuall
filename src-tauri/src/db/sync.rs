use tauri::{AppHandle, Emitter, Manager};

use crate::db::error::DbError;
use crate::db::models::{Employee, TimeEntry};
use crate::db::repo::{cards, employees, outbox, time_entries};
use crate::db::DbState;
use sqlx::{PgPool, SqlitePool};

/// Replays a queued card rotation. If the central counter has advanced past
/// the queued one, another terminal rotated the same card offline — an
/// unsupported multi-terminal situation — so block the card rather than
/// silently overwrite the newer token.
async fn reconcile_card(
    pg: &PgPool,
    lite: &SqlitePool,
    card: &cards::Card,
) -> Result<(), DbError> {
    let central: Option<i64> =
        sqlx::query_scalar("SELECT token_counter FROM cards WHERE id = $1")
            .bind(&card.id)
            .fetch_optional(pg)
            .await?;

    if matches!(central, Some(c) if c > card.token_counter) {
        let mut blocked = card.clone();
        blocked.status = "blocked".to_string();
        cards::upsert_pg(pg, &blocked).await?;
        cards::upsert_local(lite, &blocked).await?;
        return Ok(());
    }

    cards::upsert_pg(pg, card).await?;
    Ok(())
}

/// Replays queued offline writes against Postgres, then refreshes the SQLite
/// mirror from Postgres (which is authoritative for master data).
pub(crate) async fn run_sync(app: &AppHandle) -> Result<(), DbError> {
    let state = app.state::<DbState>();

    let Some(pg) = state.pg_if_online().await else {
        return Ok(()); // nothing to do while offline
    };

    let _ = app.emit("sync_event", "sync_started");

    for row in outbox::pending(&state.lite).await? {
        let result = match row.op_type.as_str() {
            "upsert_employee" => match serde_json::from_str::<Employee>(&row.payload) {
                Ok(e) => employees::upsert_pg(&pg, &e).await,
                Err(e) => Err(DbError::InvalidInput(format!("bad outbox payload: {e}"))),
            },
            "upsert_time_entry" => match serde_json::from_str::<TimeEntry>(&row.payload) {
                Ok(e) => time_entries::upsert_row_pg(&pg, &e).await,
                Err(e) => Err(DbError::InvalidInput(format!("bad outbox payload: {e}"))),
            },
            "delete_time_entry" => match serde_json::from_str::<time_entries::DeleteTimeEntryDay>(&row.payload)
            {
                Ok(payload) => time_entries::delete_day_pg(&pg, &payload).await,
                Err(e) => Err(DbError::InvalidInput(format!("bad outbox payload: {e}"))),
            },
            "card_token_rotate" => match serde_json::from_str::<cards::Card>(&row.payload) {
                Ok(card) => reconcile_card(&pg, &state.lite, &card).await,
                Err(e) => Err(DbError::InvalidInput(format!("bad outbox payload: {e}"))),
            },
            other => Err(DbError::InvalidInput(format!("unknown outbox op: {other}"))),
        };

        match result {
            Ok(()) => outbox::mark_synced(&state.lite, row.id).await?,
            Err(DbError::InvalidInput(msg)) => {
                // Undecodable rows would wedge the queue forever; drop them.
                eprintln!("dropping malformed outbox row {}: {msg}", row.id);
                outbox::mark_synced(&state.lite, row.id).await?;
            }
            Err(e) => {
                // Connectivity died mid-replay; stop and retry on next cycle.
                state.mark_offline();
                let _ = app.emit("sync_event", "sync_interrupted");
                return Err(e);
            }
        }
    }

    pull_master_data(app).await?;

    let _ = app.emit("sync_event", "sync_finished");
    let _ = app.emit("sync:users", "updated");
    Ok(())
}

/// Refreshes the SQLite mirror (employees + time entries) from Postgres.
pub(crate) async fn pull_master_data(app: &AppHandle) -> Result<(), DbError> {
    let state = app.state::<DbState>();
    let Some(pg) = state.pg_if_online().await else {
        return Ok(());
    };

    employees::pull_from_pg(&pg, &state.lite).await?;
    time_entries::pull_from_pg(&pg, &state.lite).await?;
    Ok(())
}
