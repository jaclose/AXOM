mod menu_bar_timer;
mod webview_dialogs;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem, Submenu},
    Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_sql::{Migration, MigrationKind};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStatus {
    version: String,
    updater_configured: bool,
    platform: &'static str,
}

fn updater_configured(app: &tauri::AppHandle) -> bool {
    app.config().plugins.0.get("updater").is_some_and(|config| {
        config
            .get("pubkey")
            .and_then(|v| v.as_str())
            .is_some_and(|key| !key.is_empty())
            && config
                .get("endpoints")
                .and_then(|v| v.as_array())
                .is_some_and(|v| !v.is_empty())
    })
}

#[tauri::command]
fn desktop_status(app: tauri::AppHandle) -> DesktopStatus {
    DesktopStatus {
        version: app.package_info().version.to_string(),
        updater_configured: updater_configured(&app),
        platform: std::env::consts::OS,
    }
}

fn is_app_url(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.port() == Some(5173))
}

fn open_external(app: &tauri::AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "https" | "http" | "mailto") {
        // Never pass arbitrary file, shell or custom protocols to the OS.
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_local_vault_snapshot_tables",
        sql: include_str!("../migrations/001_local_vault.sql"),
        kind: MigrationKind::Up,
    }];

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:noctyrium.db", migrations)
                .build(),
        )
        .manage(menu_bar_timer::MenuBarTimerState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            menu_bar_timer::menu_bar_timer_update,
            menu_bar_timer::menu_bar_timer_clear,
        ])
        .setup(|app| {
            // Unsigned development packages remain usable without a fake update key.
            if updater_configured(app.handle()) {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let config = app
                .config()
                .app
                .windows
                .first()
                .ok_or("Missing main window configuration")?;
            let main_window = tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(move |url| {
                    if is_app_url(url) {
                        true
                    } else {
                        open_external(&navigation_app, url);
                        false
                    }
                })
                .on_new_window(move |url, _| {
                    open_external(&popup_app, &url);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            // Without this, confirm() returns false and prompt() null in the desktop app,
            // so every restore, merge and delete confirmation cancels itself.
            webview_dialogs::install(&main_window);
            let menu = Menu::default(app.handle())?;
            let check = MenuItem::with_id(
                app,
                "check-updates",
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let updates = Submenu::with_items(app, "Updates", true, &[&check])?;
            menu.append(&updates)?;
            app.set_menu(menu)?;
            menu_bar_timer::setup(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "check-updates" {
                let _ = app.emit("axom:check-for-updates", ());
            }
        })
        .on_window_event(menu_bar_timer::on_window_event)
        .build(tauri::generate_context!())
        .expect("Unable to start AXOM desktop; local data has not been reset");

    app.run(menu_bar_timer::on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_app_origins_receive_native_access() {
        assert!(is_app_url(&"tauri://localhost/index.html".parse().unwrap()));
        assert!(is_app_url(&"http://tauri.localhost/".parse().unwrap()));
        for url in [
            "https://example.org",
            "https://tauri.localhost.evil.test",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://localhost:9999/",
        ] {
            assert!(!is_app_url(&url.parse().unwrap()), "{url}");
        }
    }
}
