# Releasing & auto-update

TWUI Editor auto-updates from this repo's GitHub Releases. The installed app checks
`https://github.com/Ironictw2st/TWUIEditor/releases/latest/download/latest.json` on startup and
prompts the user to install a newer signed version.

## One-time setup (required before the first release)

The release workflow signs updates with the updater key generated locally at
`src-tauri/.tauri-updater.key` (gitignored — keep it safe; if lost, existing installs can no longer
auto-update). Add it to the repo so CI can sign:

GitHub repo -> **Settings -> Secrets and variables -> Actions -> New repository secret**:

- `TAURI_SIGNING_PRIVATE_KEY` = the full contents of `src-tauri/.tauri-updater.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the key password (empty if you generated it without one)

The matching **public** key is already committed in `src-tauri/tauri.conf.json`
(`plugins.updater.pubkey`); the app verifies downloads against it.

## Cutting a release

1. Bump the version in **both** `src-tauri/tauri.conf.json` and `package.json` (same semver, e.g.
   `0.0.2`).
2. Commit the bump.
3. Tag and push:
   ```
   git tag v0.0.2
   git push origin v0.0.2
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) builds the Windows installer, signs it,
   and publishes a GitHub Release with the installer + `latest.json`.
5. Anyone running an older installed build is prompted to **Install & Restart** on next launch.

## Notes

- Auto-update only works from a build that already contains the updater (this version onward) and
  that was installed via the released installer (not a raw `target/debug` exe).
- The updater uses a minisign signature for integrity; it is independent of Windows Authenticode
  code-signing. Without an Authenticode certificate, Windows SmartScreen may warn on first install,
  but auto-update still functions.
- To test the whole loop: install a release, bump + tag the next version, let CI publish, reopen the
  installed app, and confirm the update prompt -> install -> relaunch on the new version.
