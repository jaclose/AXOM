fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::init())
        .invoke_handler(tauri::generate_handler![
            // Custom native commands will be added here
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
