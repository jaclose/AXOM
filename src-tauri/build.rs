fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["hub_folder_open", "hub_folder_info"]),
        ),
    )
    .expect("AXOM native permissions must validate");
}
