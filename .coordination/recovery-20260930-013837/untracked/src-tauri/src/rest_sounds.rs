// References the installed system's named NSSound resources. No Apple audio
// files are read into the webview, copied, bundled, or redistributed.
const NAMES: [&str; 3] = ["Ping", "Blow", "Glass"];

#[tauri::command]
pub fn rest_system_sounds() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSSound;
        use objc2_foundation::NSString;
        return NAMES.iter().filter(|name| NSSound::soundNamed(&NSString::from_str(name)).is_some()).map(|name| name.to_string()).collect();
    }
    #[cfg(not(target_os = "macos"))]
    Vec::new()
}

#[tauri::command]
pub fn rest_system_sound(name: String, volume: f32, stop: bool) -> Result<(), String> {
    if !NAMES.contains(&name.as_str()) || !volume.is_finite() {
        return Err("Choose an available AXOM system tone.".into());
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSSound;
        use objc2_foundation::NSString;
        let sound = NSSound::soundNamed(&NSString::from_str(&name)).ok_or("This sound is unavailable on this Mac.")?;
        if stop { sound.stop(); return Ok(()); }
        sound.setVolume(volume.clamp(0.0, 1.0));
        if sound.play() { Ok(()) } else { Err("This Mac could not play the selected sound.".into()) }
    }
    #[cfg(not(target_os = "macos"))]
    { let _ = stop; Err("System tones are available on macOS.".into()) }
}
