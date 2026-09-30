use serde::Serialize;
use std::path::{Component, PathBuf};
use tauri_plugin_opener::OpenerExt;

fn validated_directory(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() || path.chars().any(char::is_control) {
        return Err("Choose a valid local folder path.".into());
    }
    let expanded = if let Some(relative) = path.strip_prefix("~/") {
        let home = std::env::var_os("HOME").ok_or("The home folder is unavailable.")?;
        PathBuf::from(home).join(relative)
    } else {
        PathBuf::from(path)
    };
    if !expanded.is_absolute() || expanded.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("Use an absolute folder path without parent-directory shortcuts.".into());
    }
    let canonical = expanded.canonicalize().map_err(|_| "This folder is missing or inaccessible on this device.")?;
    if !canonical.is_dir() {
        return Err("Choose a folder, not an individual file.".into());
    }
    Ok(canonical)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo {
    entries: usize,
    entries_capped: bool,
    modified_at: Option<u64>,
}

#[tauri::command]
pub fn hub_folder_info(path: String) -> Result<FolderInfo, String> {
    let path = validated_directory(&path)?;
    let entries = std::fs::read_dir(&path).map_err(|_| "AXOM cannot read this folder.")?.take(10_001).count();
    let modified_at = std::fs::metadata(path).ok().and_then(|meta| meta.modified().ok())
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|time| time.as_secs());
    Ok(FolderInfo { entries: entries.min(10_000), entries_capped: entries > 10_000, modified_at })
}

#[tauri::command]
pub fn hub_folder_open(app: tauri::AppHandle, path: String, reveal: bool) -> Result<(), String> {
    let directory = validated_directory(&path)?;
    // The opener receives a canonical directory directly; no shell or command text.
    if reveal {
        app.opener().reveal_item_in_dir(directory).map_err(|_| "The file manager could not reveal this folder.".into())
    } else {
        app.opener().open_path(directory.to_string_lossy(), None::<&str>)
            .map_err(|_| "The file manager could not open this folder.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_urls_relative_paths_control_characters_and_files() {
        for path in ["", "./relative", "https://example.com", "/tmp/../etc", "/tmp/\nfolder", file!()] {
            assert!(validated_directory(path).is_err(), "{path}");
        }
    }
    #[test]
    fn accepts_existing_absolute_directory() {
        let temp = std::env::temp_dir();
        assert_eq!(validated_directory(temp.to_str().unwrap()).unwrap(), temp.canonicalize().unwrap());
    }
}
