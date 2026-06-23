# Releasing & auto-update

TWUI Editor is distributed as a **portable Windows exe** and self-updates from this repo's
GitHub Releases (RPFM-style): the running app checks the latest release, downloads the new
`TWUI-Editor-x64.exe`, swaps itself in place, and relaunches. No installer and no signing key.

## Cutting a release

1. Bump the version (same semver) in all four places:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/Cargo.lock` (the `twui-editor` package entry)
2. Commit the bump.
3. Tag and push:
   ```
   git tag v0.0.3
   git push origin v0.0.3
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) builds the frontend + a release
   `cargo build`, then publishes a GitHub Release with the portable **`TWUI-Editor-x64.exe`**.
5. Anyone running an older copy is prompted (startup banner, or Settings -> About / Updates ->
   Check for updates) to download and relaunch into the new version.

## How the updater works

- Rust commands in `src-tauri/src/update.rs`:
  - `check_update` queries `https://api.github.com/repos/<OWNER>/<REPO>/releases/latest`,
    compares the release tag to `CARGO_PKG_VERSION`, and returns the portable asset URL when
    newer. (Edit the `OWNER`/`REPO`/`ASSET_NAME` consts there if the repo or asset name changes.)
  - `install_update` streams the exe down (emitting `update-progress`), replaces the running
    binary with the `self-replace` crate, and calls `app.restart()`.
- The frontend wrapper is `src/updater.ts`; the UI is `src/panels/UpdateBanner.tsx` (startup,
  release builds only) and the **About / Updates** section in `src/panels/SettingsPanel.tsx`.
- Debug builds never report an update, so `npm run tauri dev` won't try to self-replace.

## Notes

- **WebView2 Runtime** must be present (preinstalled on current Windows 10/11). The portable exe
  doesn't bundle the installer's WebView2 bootstrapper, so on a machine missing it the app won't
  start until the Evergreen runtime is installed.
- Trust model is HTTPS + GitHub release authenticity (no minisign signature). The old updater
  signing key (`src-tauri/.tauri-updater.key*`) is **no longer used** and can be deleted.
- Without an Authenticode certificate, Windows SmartScreen may warn the first time the exe runs.
- The GitHub API check is unauthenticated (~60 requests/hour/IP) — ample for a desktop app.
- To test the full loop: build the current portable exe and run it from a folder, publish a
  higher-version release containing `TWUI-Editor-x64.exe`, then in the running older exe use
  Check for updates and confirm download -> self-replace -> relaunch on the new version.
