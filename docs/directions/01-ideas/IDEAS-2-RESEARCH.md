# Ideas 2 research checkpoint (2026-09-30)

## Decisions grounded in current interfaces

- Spotify [IFrame API](https://developer.spotify.com/documentation/embeds/references/iframe-api) supports a persistent controller, observed playback updates and transport actions. Playback URI is not track metadata. Keep telemetry truthful; do not inspect iframe DOM. [Playback Web API](https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback) requires user authorization. Existing embed integration does not imply that authorization.
- Spotify [oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed) supplies public display metadata. Endpoint returned HTTP 200 and CORS * during this check. A once-daily cache may refresh titles separately from the player controller; never inject returned HTML or reload active playback for metadata.
- Tauri [capabilities](https://v2.tauri.app/security/capabilities/) describe an easily missed default: registered application commands are available to local webviews unless put under AppManifest command permissions. Hub commands now use explicit permissions attached to main, plus native window/origin checks and canonical directory validation. [Opener](https://v2.tauri.app/plugin/opener/) accepts a path directly, no shell text.
- DOM [Range](https://developer.mozilla.org/en-US/docs/Web/API/Range/compareBoundaryPoints) provides selection boundaries. AXOM already uses source-text offsets; retain this model and merge compatible intervals rather than nested DOM marks. Real pointer tests validate browser selection rather than synthetic mouseup alone.

## Bookmark/tool capability survey

Relevant saved resources inspected: Playwright agent CLI skills, Tauri SQL/updater/docs, Resend, Raycast, myNoise, eqMac, Jitter, HorizonX, WindowSwap, Pixabay motion backgrounds. The immediate useful capability is the installed Playwright/Chrome stack for repeatable real drags, viewport screenshots and console checks; Rust tests plus a separate native QA identifier cover native boundaries. No additional framework or MCP server is needed for these contracts. Jitter/HorizonX concern visual polish; audio engines/mixing remain Claude-owned. No credits or licensed media were consumed.

The bookmarked WindowSwap /Window URL returned HTTP 404 on this check. Do not claim it is embeddable or licensed. Keep any third-party ambient experience external until an explicit technical and licensing contract is verified.
