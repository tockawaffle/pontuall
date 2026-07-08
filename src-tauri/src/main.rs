// Prevents an additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Arc;
use std::sync::Mutex;
use tauri::Manager;

use crate::auth::commands::{
    auth_admin_ban_user, auth_admin_list_users, auth_admin_remove_user,
    auth_admin_send_password_reset, auth_admin_set_role, auth_admin_unban_user,
    auth_audit_list, auth_audit_verify, auth_bootstrap_admin, auth_change_password,
    auth_create_account, auth_current_user, auth_has_admin, auth_session_capabilities,
    auth_session_has_permission, auth_sign_in, auth_sign_out,
    start_backend_services,
};
use crate::auth::AuthState;
use crate::card::commands::{
    card_await_tap, card_cancel, card_diagnostic, export_card_master_key, import_card_master_key,
    provision_card, reader_status, reprovision_card, set_card_status, unprovision_card,
};
use crate::card::service::CardService;
use crate::db::commands::{
    delete_time_entry_day, employee_terminate, gen_id, get_cache, get_users_and_cache,
    insert_new_user, update_cache_hour_data, update_employee,
};
use crate::db::setup_cmds::{insert_db_config, test_db_connection};
use crate::db::DbState;
use crate::excel::create::create_excel_relatory;
use crate::misc::advanced::{get_advanced_config_cmd, set_advanced_config_cmd};
use crate::misc::get::version_name;
use crate::misc::punch::{
    get_manual_punch_status, get_smtp_config_cmd, request_punch_otp, set_manual_punch_enabled_cmd,
    set_smtp_config_cmd, test_smtp_config_cmd, verify_punch_otp,
};
use crate::misc::setup::{complete_setup, SetupState};
use crate::misc::work_hours::{get_work_hours_cmd, save_work_hours_cmd};

mod app_flavor;
mod auth;
mod card;
mod db;
mod excel;
mod misc;

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.webview_windows().values().next() {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(CardService::new()))
        .manage(AuthState::new())
        .manage(Mutex::new(SetupState {
            frontend_task: false,
            backend_task: false,
        }))
        .setup(|app| {
            // The SQLite mirror must exist before any command runs; Postgres
            // is connected later during the splashscreen setup flow.
            let lite = tauri::async_runtime::block_on(db::init_sqlite())?;
            app.manage(DbState::new(lite));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Card reader
            reader_status,
            card_await_tap,
            card_cancel,
            provision_card,
            reprovision_card,
            unprovision_card,
            set_card_status,
            card_diagnostic,
            export_card_master_key,
            import_card_master_key,
            // Employees / punches
            gen_id,
            get_cache,
            insert_new_user,
            update_employee,
            employee_terminate,
            update_cache_hour_data,
            delete_time_entry_day,
            get_users_and_cache,
            // Setup / System related
            complete_setup,
            insert_db_config,
            test_db_connection,
            start_backend_services,
            version_name,
            // Relatories
            create_excel_relatory,
            // Auth
            auth_sign_in,
            auth_sign_out,
            auth_current_user,
            auth_change_password,
            auth_has_admin,
            auth_bootstrap_admin,
            auth_create_account,
            auth_admin_list_users,
            auth_admin_send_password_reset,
            auth_admin_set_role,
            auth_admin_ban_user,
            auth_admin_unban_user,
            auth_admin_remove_user,
            auth_session_capabilities,
            auth_session_has_permission,
            auth_audit_list,
            auth_audit_verify,
            // Manual punch / SMTP
            get_manual_punch_status,
            set_manual_punch_enabled_cmd,
            get_smtp_config_cmd,
            set_smtp_config_cmd,
            test_smtp_config_cmd,
            request_punch_otp,
            verify_punch_otp,
            get_advanced_config_cmd,
            set_advanced_config_cmd,
            // Work hours (schedule config, persisted to DB)
            get_work_hours_cmd,
            save_work_hours_cmd,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            crate::auth::sidecar::stop(app_handle);
        }
    });
}
