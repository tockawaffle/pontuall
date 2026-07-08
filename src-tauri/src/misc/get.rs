#[tauri::command]
pub(crate) fn version_name(version: String) -> String {
    match version.as_str() {
        "0.1.0" => "Yttrium".to_string(),
        "0.1.1" => "Reforged Yttrium".to_string(),
        "0.1.2" => "Yttrium-Aluminium Alloy".to_string(),
        "0.2.0" => "Neodymium".to_string(),
        "0.3.1" => "Praseodymium".to_string(),
        _ => "noname".to_string(),
    }
}
