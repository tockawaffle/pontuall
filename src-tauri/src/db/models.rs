use std::collections::HashMap;

use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Date keys the frontend uses for `hour_data` maps ("dd/mm/yyyy", the
/// pt-BR `toLocaleDateString()` output the app has always produced).
pub(crate) const DAY_KEY_FORMAT: &str = "%d/%m/%Y";

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub(crate) struct Employee {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub lunch_time: Option<String>,
    pub status: String,
    pub auth_user_id: Option<String>,
    pub terminated_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub exclude_from_report: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub(crate) struct TimeEntry {
    pub id: String,
    pub employee_id: String,
    pub work_date: NaiveDate,
    pub clock_in: Option<DateTime<Utc>>,
    pub lunch_out: Option<DateTime<Utc>>,
    pub lunch_return: Option<DateTime<Utc>>,
    pub clock_out: Option<DateTime<Utc>>,
    pub updated_at: DateTime<Utc>,
    /// JSON map of field -> punch source (`card`, `manual_otp`).
    pub punch_sources: Option<String>,
}

/// Legacy wire format consumed by the frontend (`CachedUsers` /
/// `IUsers` in `types.d.ts`) and by the Excel report command.
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub(crate) struct HourData {
    pub(crate) clock_in: String,
    pub(crate) lunch_break_out: String,
    pub(crate) lunch_break_return: String,
    pub(crate) clocked_out: String,
    pub(crate) total_hours: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub(crate) struct UserExternal {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) email: Option<String>,
    pub(crate) image: Option<String>,
    pub(crate) role: String,
    pub(crate) hour_data: Option<HashMap<String, HourData>>,
    pub(crate) lunch_time: Option<String>,
    pub(crate) status: Option<String>,
    pub(crate) phone: Option<String>,
    /// Better Auth role (`employee`, `supervisor`, `administrator`); null without login.
    pub(crate) access_role: Option<String>,
    pub(crate) auth_user_id: Option<String>,
    #[serde(default)]
    pub(crate) exclude_from_report: bool,
}

fn local_time_string(ts: Option<DateTime<Utc>>) -> String {
    match ts {
        Some(ts) => ts.with_timezone(&Local).format("%H:%M:%S").to_string(),
        None => "N/A".to_string(),
    }
}

fn total_hours_string(entry: &TimeEntry) -> String {
    let (Some(clock_in), Some(clock_out)) = (entry.clock_in, entry.clock_out) else {
        return "N/A".to_string();
    };
    let mut worked = clock_out - clock_in;
    if let (Some(out), Some(back)) = (entry.lunch_out, entry.lunch_return) {
        if back > out {
            worked = worked - (back - out);
        }
    }
    if worked < chrono::Duration::zero() {
        return "N/A".to_string();
    }
    let minutes = worked.num_minutes();
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

impl TimeEntry {
    pub(crate) fn to_hour_data(&self) -> HourData {
        HourData {
            clock_in: local_time_string(self.clock_in),
            lunch_break_out: local_time_string(self.lunch_out),
            lunch_break_return: local_time_string(self.lunch_return),
            clocked_out: local_time_string(self.clock_out),
            total_hours: total_hours_string(self),
        }
    }
}

impl Employee {
    pub(crate) fn to_user_external(
        &self,
        entries: &[TimeEntry],
        access_role: Option<String>,
    ) -> UserExternal {
        let hour_data = entries
            .iter()
            .filter(|e| e.employee_id == self.id)
            .map(|e| (e.work_date.format(DAY_KEY_FORMAT).to_string(), e.to_hour_data()))
            .collect::<HashMap<_, _>>();

        UserExternal {
            id: self.id.clone(),
            name: self.name.clone(),
            email: self.email.clone(),
            image: None,
            role: self.role.clone(),
            hour_data: Some(hour_data),
            lunch_time: self.lunch_time.clone(),
            status: Some(self.status.clone()),
            phone: self.phone.clone(),
            access_role,
            auth_user_id: self.auth_user_id.clone(),
            exclude_from_report: self.exclude_from_report,
        }
    }
}

/// Parses the frontend's day key ("dd/mm/yyyy", with ISO as a fallback).
pub(crate) fn parse_day_key(day: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(day, DAY_KEY_FORMAT)
        .or_else(|_| NaiveDate::parse_from_str(day, "%Y-%m-%d"))
        .ok()
}

/// Combines a day key and a local "HH:MM[:SS]" string into a UTC timestamp.
pub(crate) fn parse_local_time(day: NaiveDate, value: &str) -> Option<DateTime<Utc>> {
    let time = NaiveTime::parse_from_str(value, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M"))
        .ok()?;
    Local
        .from_local_datetime(&day.and_time(time))
        .single()
        .map(|dt| dt.with_timezone(&Utc))
}
