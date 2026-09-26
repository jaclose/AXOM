# AXOM desktop and web releases

## Daily development and local packages

Use Node 22.12+ (CI uses Node 24), Rust stable, and the platform prerequisites
from [Tauri](https://v2.tauri.app/start/prerequisites/). On macOS, install Xcode
command-line tools. Install pinned JS dependencies once:

```sh
cd /Users/jd/Developer/AXOM
npm --prefix web ci
npm run release:doctor
npm run tauri:dev
```

The only active desktop project is root `src-tauri/`. The incomplete
`web/src-tauri/` scaffold and original Swift sources are retained as historical
reference. The release pipeline does not build them. From either root or web:

```sh
npm run release                 # web ZIP + native packages for this machine
npm run release:web             # web ZIP only; Rust not required
```

The old `web/scripts/release.sh` redirects to this same pipeline. It fails when
a requested native build fails; it never silently skips desktop and announces
a successful complete release. It builds web once, then packages that build.
Outputs are under `dist/releases/<version>/web/` and
`dist/releases/<version>/<platform>-<architecture>/`, with SHA-256 checksums,
build identity and per-package manifests. Prior local outputs are retained as
`.previous-<timestamp>` siblings on rebuild. Interrupted runs remain under
`.staging-*` for diagnosis. These directories are disposable build products.

Local Mac builds are for testing and are not Apple-notarized distribution
builds. Their updater is explicitly disabled. Use a signed distribution build
to start receiving in-app desktop updates; there is no embedded placeholder key.

The native icons are generated automatically during each desktop release from
`web/public/icon-512.png`: the current ivory AXOM mark on black. Update this
canonical artwork and the web favicon/touch icon when rebranding; no separate
desktop artwork needs to be maintained. Keep the bundle/storage identity unchanged.

## One-time signing and distribution setup

Tauri requires an Ed25519 update key even on Windows/Linux. This is separate
from Apple Developer ID and Windows Authenticode publisher certificates.
Generate the updater key interactively in a secure location outside the repo:

```sh
npm --prefix web run tauri -- signer generate -w /absolute/secure/path/axom-updater.key
```

Back up the private key and password securely. Never commit them, paste them
into an issue, or regenerate the key for every release. An existing installed
app trusts the original public key, so losing its private key breaks that
update channel. [Official updater guide](https://v2.tauri.app/plugin/updater/).

Configure these GitHub repository **variables**:

| Variable | Value |
| --- | --- |
| `AXOM_UPDATER_PUBLIC_KEY` | Full base64 text inside the generated `.pub` file |
| `AXOM_UPDATER_ENDPOINT` | Public HTTPS URL serving Tauri `latest.json` |

For a public GitHub repository and stable releases, the standard endpoint is
`https://github.com/jaclose/Noctyrium/releases/latest/download/latest.json`.
Verify this repository is public before using it. A private repository needs
separate publicly readable release hosting, including package downloads.
The supplied workflow assembles download URLs for GitHub release assets; it
therefore refuses private repositories, even with a custom manifest endpoint.
It does not automatically mirror assets to a separate host. Supporting a
private source repository requires a separate public-artifact publishing step
and corresponding download URLs before enabling this release workflow.

Configure these **secrets**:

| Secret | Purpose |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Contents of the private updater key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password used when generating the key |
| `APPLE_CERTIFICATE` | Base64 exported Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Password protecting that certificate |
| `APPLE_SIGNING_IDENTITY` | Exact Developer ID Application identity |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID, app-specific password and team for notarization |

The release job imports the Apple identity using Tauri's signing support.
The local script also supports Apple's API key environment alternative
(`APPLE_API_KEY`, `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`); customize CI to
materialize the key securely if using that route. See
[Apple signing and notarization](https://v2.tauri.app/distribute/sign/macos/).
Windows updater authenticity works with the Tauri key. Windows publisher
signing/SmartScreen reputation is a separate certificate/CI integration and
is not configured by this change. Do not advertise it as Authenticode-signed.

Check configuration without building or publishing:

```sh
npm run release:doctor -- --signed
```

Environment values are checked for presence/format without printing secrets.
Actual key matching, package signatures and Apple notarization are verified
during the signed build. Preflight cannot establish that remote credentials
are valid or the eventual endpoint is reachable until they are configured.
Signatures also bind each artifact to its announced app version. Both the
release assembler and installed updater reject a response that pairs an old
signed payload with a different version number; unsigned version metadata
alone is never sufficient authorization to install it.

## Normal releases

Set the version once. This updates web/root npm manifests and locks, Cargo
manifest and lock; native config and visible UI derive from web/package.json.

```sh
npm run release:version -- 0.1.0
npm --prefix web run quality
npm run test:release
```

Review and commit the app changes and version files. Create and push the
matching `v0.1.0` tag when you intend to run distribution CI. A tag push, or
manual execution of **AXOM Release Draft** against an existing exact tag:

1. Verifies the tag, version, immutable commit and signing configuration.
2. Runs release regression tests, typecheck, lint, tests and web build.
3. Builds macOS Apple Silicon and Intel, Windows x64 and Linux x64 independently.
4. Verifies Apple signatures/notarization and every updater signature locally.
5. Collects a web ZIP plus the complete desktop set. Checks hashes, versions,
   build IDs, updater signatures, unique filenames and required platforms.
6. Creates one **draft** GitHub release, never automatically publishes it.

Windows uses an NSIS `.exe` installer for both normal installation and updates.
MSI is not built by default because Windows MSI versions cannot represent text
SemVer prereleases such as `0.0.1-prebeta`; adding MSI requires an explicit,
stable numeric Windows versioning policy and separate installer verification.

Inspect the draft, write user-facing changes/migration notes, and smoke-test
the installers and a real N → N+1 update before publishing. Failed matrix jobs
cannot publish a partial updater manifest. Existing release tags are never
overwritten by the workflow. An incomplete existing draft requires review
before rerunning rather than silent replacement.

The current `0.0.1-prebeta` version is a prerelease. GitHub's `/releases/latest`
does **not** select prereleases. Either use a stable version for this channel,
or provision a separate prerelease feed and point prerelease builds to it.
This pipeline does not silently promote a prerelease into the stable feed.

## Web distribution

Existing Vercel Git deployment remains the web publishing mechanism; no second
deployment workflow or commit-back bot is needed. Cache headers make HTML,
version metadata and the worker revalidate, while hashed assets are immutable.
The downloadable ZIP is a static website, not a `file://` application. Serve
its contents over HTTPS or run the included dependency-free local server:

```sh
node serve.mjs
# Open http://127.0.0.1:4173
```

Keep the same browser/origin/port to keep the same vault. `serve.mjs` listens
only on loopback and rejects traversal; it is a local preview server, not a
production internet-facing server. For other hosts, deploy atomically and
keep old hashed assets during rollout so already-open tabs can finish. Serve
API endpoints separately; the static package does not contain the optional backend.

## Keeping updates safe as AXOM changes

- Preserve `com.noctyrium.alpha`, `sqlite:noctyrium.db` and frozen storage keys.
  Display-name changes must never change storage identity.
- Keep native `frontendDist` local. Web releases do not inject remote code into
  the desktop webview; desktop code arrives as a signed whole-app update.
- Every user-approved update awaits pending saves, reads back the current
  workspace and verifies a recovery snapshot before installing/reloading.
  Desktop additionally saves a SQLite snapshot. Failed snapshots stop updates.
- Automatic snapshots cover workspace JSON and settings. Question image blobs
  stay in their existing store; **portable exports** include those bytes.
  Back up before changing wrapper, browser, origin or device.
- The old Swift wrapper and new Tauri app have different data containers.
  Export from the old app and import into Tauri; copying/replacing the app does
  not migrate data across those containers.
- A storage schema change needs a forward migration and a test using the
  previous data format. Older builds detecting a newer schema stop before
  importing/hydrating the store. Never solve a bad release by downgrading data;
  ship a higher-version forward fix.
- Do not rotate signing keys, bundle identifiers or updater URLs casually.
  A public-key rotation needs a transition release while the original key works.
- `src-tauri/migrations` SQL migrations are append-only; never edit a migration
  already installed by users. Add the next numbered migration instead.
- Native dependencies/config changes need builds on each supported OS. Normal
  frontend changes use the same packaging workflow without wrapper edits.
- Dependabot proposes monthly grouped minor/patch updates for the web, Rust
  wrapper and pinned GitHub actions. These remain reviewable pull requests;
  nothing is automatically merged, tagged or released.

## Release smoke checks and recovery

Test fresh install, launch/relaunch, single instance, window position, external
links, imports/exports and offline launch. For updates, start with N installed,
create data, offer signed N+1, defer it, download it, install with consent, and
verify data after restart. Exercise offline checks, tampered signatures,
insufficient storage and a failed migration. Confirm the app can read a saved
recovery snapshot and that a full portable backup restores question images.

`npm run release:doctor` diagnoses prerequisites; release failure is never
success. Check free disk space before a first Rust build (4+ GiB recommended).
Preflight stops below 2 GiB for native builds or 256 MiB for web-only packages. Build
caches can be regenerated with `cargo clean --manifest-path src-tauri/Cargo.toml`;
that command only cleans Rust output, never the live app-data directory.

Implemented mechanisms and local test results are not proof of a live update
channel. Production credentials, CI execution on all OS targets, public hosting,
and the signed two-version install/restart smoke test must be completed before
calling automatic distribution production-verified.
