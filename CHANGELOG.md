# Changelog

Notable changes per release. The section for a tagged version becomes that release's notes,
shown in the app's update prompt (Settings -> About / Updates and the startup banner).

## [Unreleased]

### Added
- Program version shown next to the toolbar logo.
- Patch notes now ship with each update: releases carry curated notes from this file,
  rendered in the in-app update prompt.

## [0.0.4] - 2026-06-23

- Internal test release (version bump to validate the self-updater); no user-facing changes.

## [0.0.3] - 2026-06-23

### Added
- Light / Dark theme that follows the system setting, plus accent colour and a compact
  density (Settings -> Theme).
- Movable and hidable tool palette in the Visualizer.
- Render-resolution selector (Perspective) with resolution-aware reflow of edge-docked panels.
- Hierarchy: force-show toggle to reveal a component hidden by a script/context binding.
- New shortcuts: Open (`Ctrl+O`), Save As (`Ctrl+Shift+S`), Simulate, Tooltip; plus a manual
  **Check for updates** (Settings -> About / Updates).

### Changed
- Switched to a portable, self-updating build (replaces the installer-based updater).

### Fixed
- Hierarchy: items under the same parent now align at the same indent.
- Components hidden by a script/context binding are dimmed in the Hierarchy and no longer
  reserve a layout slot.
- Visualizer no longer re-fits the view on every edit.
