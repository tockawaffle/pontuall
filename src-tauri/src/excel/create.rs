use std::collections::HashMap;

use chrono::{Datelike, Duration, NaiveDate, NaiveTime, Weekday};
use rust_xlsxwriter::*;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::auth::guard;
use crate::db::models::{HourData, UserExternal};
use crate::auth::permissions::PermissionAction;
use crate::excel::error::ExcelError;

fn parse_date(value: &str) -> Result<NaiveDate, ExcelError> {
    NaiveDate::parse_from_str(value, "%d/%m/%Y")
        .or_else(|_| NaiveDate::parse_from_str(value, "%Y-%m-%d"))
        .map_err(|_| ExcelError::InvalidDate(value.to_string()))
}

fn parse_time(value: &str) -> Result<NaiveTime, ExcelError> {
    NaiveTime::parse_from_str(value, "%H:%M:%S")
        .or_else(|_| NaiveTime::parse_from_str(value, "%H:%M"))
        .map_err(|_| ExcelError::InvalidDate(value.to_string()))
}

/// Generates an Excel report based on user attendance data.
///
/// # Arguments
///
/// * `date_start` - The start date for the report in "dd/mm/yyyy" format.
/// * `date_end` - The end date for the report in "dd/mm/yyyy" format.
/// * `entry_time` - The expected entry time in "HH:MM" format.
/// * `lunch_break` - The expected lunch break time in "HH:MM" format.
/// * `exit_time` - The expected exit time in "HH:MM" format.
/// * `tolerance` - The tolerance in minutes for early or late entries.
/// * `users` - A HashMap containing user data.
///
/// # Returns
///
/// * `Result<bool, ()>` - Returns `Ok(true)` if the report is successfully created, otherwise returns `Err(())`.
#[tauri::command]
pub(crate) async fn create_excel_relatory(
    app: AppHandle,
    date_start: String,
    date_end: String,
    entry_time: String,
    exit_time: String,
    tolerance: String,
    users: HashMap<String, UserExternal>,
) -> Result<bool, ExcelError> {
    guard::require_current(&app, PermissionAction::CreateReports).await?;

    // Let the user choose where to save instead of a hardcoded path.
    let destination = app
        .dialog()
        .file()
        .add_filter("Planilha Excel", &["xlsx"])
        .set_file_name("relatorio.xlsx")
        .blocking_save_file()
        .ok_or(ExcelError::NoDestination)?;

    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    // Write the header row
    let bold = Format::new().set_bold().set_font_size(14.0);
    worksheet.write_string_with_format(0, 0, "Nome", &bold)?;
    worksheet.write_string_with_format(0, 1, "Dia", &bold)?;
    worksheet.write_string_with_format(0, 2, "Entrada", &bold)?;
    worksheet.write_string_with_format(0, 3, "Almoço - Saída", &bold)?;
    worksheet.write_string_with_format(0, 4, "Almoço - Retorno", &bold)?;
    worksheet.write_string_with_format(0, 5, "Saída", &bold)?;

    // Define formats for early and late entries
    let early_color = Format::new()
        .set_background_color(Color::Green)
        .set_border(FormatBorder::Thin); // Early entries
    let late_color = Format::new()
        .set_background_color(Color::Red)
        .set_border(FormatBorder::Thin); // Late entries
    let unregistered_color = Format::new()
        .set_background_color(Color::Purple)
        .set_border(FormatBorder::Thin); // Unregistered entries

    // Write the legend row as a color guide
    worksheet.write_string_with_format(0, 8, "Legenda", &Format::new().set_bold())?;
    worksheet.write_string_with_format(1, 8, "Entrada antecipada", &early_color)?;
    worksheet.write_string_with_format(2, 8, "Entrada atrasada/Saida antecipada", &late_color)?;
    worksheet.write_string_with_format(3, 8, "Dia não registrado", &unregistered_color)?;
    worksheet.write_string(5, 8, "Domingos não são registrados!")?;

    worksheet.write_string(6, 8, "Horários Configurados:")?;
    worksheet.write_string(7, 8, format!("Entrada: {}", entry_time).as_str())?;
    worksheet.write_string(8, 8, format!("Saída: {}", exit_time).as_str())?;
    worksheet.write_string(9, 8, format!("Tolerância: {} minutos", tolerance).as_str())?;

    // Set column widths
    worksheet.set_column_width(0, 30)?;
    worksheet.set_column_width(1, 12)?;
    worksheet.set_column_width(2, 10)?;
    worksheet.set_column_width(3, 18)?;
    worksheet.set_column_width(4, 18)?;
    worksheet.set_column_width(5, 10)?;
    worksheet.set_column_width(8, 30)?;

    let range_start = parse_date(&date_start)?;
    let range_end = parse_date(&date_end)?;

    // Collect data rows within the date range
    let mut data_rows: Vec<(String, String, HourData)> = Vec::new();
    for (name, user) in users.iter() {
        for (date_str, hour_data) in user.hour_data.clone().unwrap_or_default() {
            let date = parse_date(&date_str)?;
            if date >= range_start && date <= range_end {
                data_rows.push((name.clone(), date_str.clone(), hour_data.clone()));
            }
        }
    }

    // Sort data rows by date and name
    data_rows.sort_by(|a, b| {
        let name_cmp = a.0.cmp(&b.0);
        if name_cmp == std::cmp::Ordering::Equal {
            // Names are equal, compare dates
            a.1.cmp(&b.1)
        } else {
            // Names are not equal, sort by name
            name_cmp
        }
    });

    // Convert tolerance to minutes
    let tolerance_minutes = tolerance
        .parse::<i32>()
        .map_err(|_| ExcelError::InvalidDate(format!("tolerância inválida: {tolerance}")))?;

    // Write the Excel file, filtering by name and date.
    let dates = generate_dates_range(range_start, range_end);

    let mut row = 1;
    let mut last_user = String::new();
    for (name, users) in users.iter() {
        if !last_user.is_empty() && last_user != *name {
            row += 1; // Increment row for the blank row
        }

        for date in &dates {
            let date_str = date.format("%d/%m/%Y").to_string();

            let hour_data = users
                .hour_data
                .clone()
                .unwrap_or_default()
                .get(&date_str)
                .cloned();

            if let Some(hour_data) = hour_data {
                let entry_time = parse_time(&entry_time)?;
                let exit_time = parse_time(&exit_time)?;

                let clock_in = if hour_data.clock_in == "N/A" {
                    None
                } else {
                    Some(parse_time(&hour_data.clock_in)?)
                };
                // Check if the clocked_out is N/A
                let clocked_out = if hour_data.clocked_out == "N/A" {
                    None
                } else {
                    Some(parse_time(&hour_data.clocked_out)?)
                };

                let is_early = clock_in.map_or(false, |clock_in| {
                    clock_in
                        .signed_duration_since(entry_time)
                        .num_minutes()
                        .abs()
                        <= tolerance_minutes as i64
                });

                let is_late = clock_in.map_or(false, |clock_in| {
                    clock_in
                        .signed_duration_since(entry_time)
                        .num_minutes()
                        .abs()
                        > tolerance_minutes as i64
                });

                let left_too_early = clocked_out.map_or(false, |clocked_out| {
                    clocked_out.signed_duration_since(exit_time).num_minutes() < 0
                });

                worksheet.write_string_with_format(
                    row,
                    0,
                    name,
                    &Format::new().set_border(FormatBorder::Thin),
                )?;
                worksheet.write_string_with_format(
                    row,
                    1,
                    &date_str,
                    &Format::new().set_border(FormatBorder::Thin),
                )?;
                worksheet.write_string_with_format(
                    row,
                    3,
                    &hour_data.lunch_break_out,
                    &Format::new().set_border(FormatBorder::Thin),
                )?;
                worksheet.write_string_with_format(
                    row,
                    4,
                    &hour_data.lunch_break_return,
                    &Format::new().set_border(FormatBorder::Thin),
                )?;

                if is_early {
                    worksheet.write_string_with_format(
                        row,
                        2,
                        &hour_data.clock_in,
                        &early_color,
                    )?;
                } else if is_late {
                    worksheet.write_string_with_format(row, 2, &hour_data.clock_in, &late_color)?;
                } else {
                    worksheet.write_string_with_format(
                        row,
                        2,
                        &hour_data.clock_in,
                        &Format::new().set_border(FormatBorder::Thin),
                    )?;
                }

                if left_too_early {
                    worksheet.write_string_with_format(
                        row,
                        5,
                        &hour_data.clocked_out,
                        &late_color,
                    )?;
                } else {
                    worksheet.write_string_with_format(
                        row,
                        5,
                        &hour_data.clocked_out,
                        &Format::new().set_border(FormatBorder::Thin),
                    )?;
                }

                row += 1;
            } else {
                // Write missing day with placeholder data
                worksheet.write_string_with_format(row, 0, name, &unregistered_color)?;
                worksheet.write_string_with_format(row, 1, &date_str, &unregistered_color)?;
                worksheet.write_string_with_format(row, 2, "N/A", &unregistered_color)?; // Placeholder for missing entry
                worksheet.write_string_with_format(row, 3, "N/A", &unregistered_color)?; // Placeholder for missing lunch break
                worksheet.write_string_with_format(row, 4, "N/A", &unregistered_color)?; // Placeholder for missing clock-out
                worksheet.write_string_with_format(row, 5, "N/A", &unregistered_color)?; // Placeholder for missing total hours

                row += 1;
            }
        }

        last_user = name.clone(); // Update the last_user to current name
    }

    workbook.save(destination.to_string())?;

    Ok(true)
}

/// Generates a range of dates between the start and end dates, excluding Sundays.
///
/// # Arguments
///
/// * `start_date` - The start date.
/// * `end_date` - The end date.
///
/// # Returns
///
/// * `Vec<NaiveDate>` - A vector of dates between the start and end dates.
fn generate_dates_range(start_date: NaiveDate, end_date: NaiveDate) -> Vec<NaiveDate> {
    let mut dates = Vec::new();
    let mut current_date = start_date;

    while current_date <= end_date {
        if current_date.weekday() != Weekday::Sun {
            dates.push(current_date);
        }
        current_date = current_date + Duration::days(1);
    }

    dates
}

// #[cfg(test)]
// mod tests {
//     use crate::cache::get::get_cache;
//     use crate::cache::set::get_users_and_cache;
//     use crate::database::connect::create_db_connection;
//     use crate::excel::create::create_excel_relatory;
//
//     /// Tests the `create_excel_relatory` function.
//     #[tokio::test]
//     async fn test_create_excel_relatory() {
//         let db = create_db_connection()
//             .await
//             ?;
//         get_users_and_cache(db).await;
//         let users = get_cache();
//
//         let users = get_cache();
//         let create = create_excel_relatory(
//             "01/08/2024".to_string(),
//             "31/08/2024".to_string(),
//             "08:00".to_string(),
//             "18:00".to_string(),
//             "10".to_string(),
//             users,
//         )
//             ?;
//
//         assert_eq!(create, true);
//     }
// }
