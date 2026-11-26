# N1PilotDesktop 1.0.3 — Monaco branch

This is the normalized source snapshot for the Monaco branch. It is derived only from the audited `N1PilotDesktop-Monaco-v1.0.2.1-hotfix-fixed.zip` candidate. No SSH, SFTP, editor, or UI feature implementation was rewritten during this normalization.

- Canonical application version: `1.0.3` (three-part SemVer).
- Monaco engine: `monaco-editor@0.57.0`, bundled locally by `scripts/build-editor.js`.
- Retains the SFTP navigation-performance and save-stage diagnostics recorded in `CHANGELOG-v1.0.2.1-sftp-performance-save-diagnostics.txt`.
- Windows portable artifact name: `N1PilotDesktop-Monaco-v1.0.3-x64.exe`.
- The previous `1.0.2.1` candidate was not a valid SemVer value. Its original ZIPs are preserved in the project's `_archive/candidates/` folder and are not release baselines.
- `package-lock.json` was not present in the audited candidate; dependency resolution is therefore not lockfile-reproducible. Do not invent a lockfile as part of this archive-only normalization.

## Historical v1.0.2.1 hotfix packaging note (superseded)

The preceding candidate used `1.0.2-hotfix.1` internally to work around the invalid four-part version `1.0.2.1`, while its ZIP and EXE names still said `v1.0.2.1`. This mismatch is normalized to `1.0.3` in the current baseline. The prior BOM cleanup and Monaco JSON diagnostics namespace correction are retained.

# N1PilotDesktop 1.0.2 — Monaco Remote Editor

Version 1.0.2 preserves the user-verified v0.6.13 SSH terminal and SFTP baseline, then adds an independent remote code editor based on **Monaco Editor 0.57.0**. The editor uses local bundled assets and inline Web Worker payloads; it does not rely on an external editor CDN. Each SFTP “Edit file” action opens its own resizable, task-switchable native window, so several remote files can remain open at once.

## Editor behavior

- Monaco provides syntax highlighting, line numbers, bracket-pair highlighting, folding, find/replace, line navigation, undo/redo, and language services where provided. Shell, JSON/JSONC, YAML, INI/config, TOML, Lua, Python, JavaScript, XML, CSS, SQL, Dockerfile, diff and plain text are selected by file name.
- Text-preservation first: automatic indentation, bracket/quote insertion, format-on-type and format-on-paste are disabled. Enter inserts a single newline and Tab inserts a literal tab. Diagnostics and pasted-text checks never rewrite the document. The invisible-character view is display-only.
- Automatic diagnostics include JSON/YAML parser results, Monaco language markers, cautious Shell structure hints, suspicious Unicode/control characters and AI-chat Markdown fences. Remote `sh -n` writes a temporary copy for syntax-only parsing; the edited script is not executed.
- Safe cleanup is opt-in and always shown in a before/after diff. Applying a suggestion is an undoable edit. Complex issues can be turned into a prompt for ChatGPT/Gemini; the full source is not included in that prompt by default.
- Encoding, BOM, line endings (including preserved mixed endings), and file size are tracked. Unrecognized/binary-looking files and files over 2 MiB are refused instead of being opened and potentially overwritten incorrectly.
- Saves compare the current remote file hash with the loaded base version and stop on conflict. The editor can compare local and remote text before a deliberate overwrite. The write path uses a same-directory temporary file plus backup/replace/rollback, rechecks the file version near replacement, and attempts to preserve mode/owner. If preservation or rollback cannot be verified, the editor reports the failure and retained backup path.
- Dirty content is periodically stored as an OS-encrypted local recovery draft when Electron `safeStorage` is available. The app asks for a final draft flush before quitting with unsaved editor windows. Restored drafts stay local until the user explicitly saves.
- Every editor remembers its own position/size/maximized state when possible. Chinese/English follows the app-wide language. DEBUG records file lifecycle and diagnostics metadata but intentionally avoids file bodies and passwords; remote paths can appear in logs.

## Architecture and dependencies

- The Monaco engine is `monaco-editor@0.57.0`. Its ESM runtime and language contributions are bundled locally by `scripts/build-editor.js` using esbuild, including self-contained worker payloads for Electron `file://` windows. No CDN is used at runtime.
- `diff`, `iconv-lite` and `yaml` support conflict/line-ending diffs, legacy text decoding and YAML diagnostics.
- The existing Electron portable EXE target, custom title bar, ChatGPT workspace, SSH tabs and interactive PTY are retained. Remote editing is additive; the SSH terminal implementation is not rewritten for this release.

## Build on Windows

1. Extract the full `N1PilotDesktop` folder.
2. Run `build.bat`. It uses the existing Node setup, compiles the Windows file-properties helper, installs npm dependencies, bundles Monaco and its workers, runs source/static tests, and creates the existing portable Windows EXE.
3. Output is in `dist`, with a filename like `N1PilotDesktop-Monaco-v1.0.3-x64.exe`. The internal npm/Electron version and the artifact now both use the canonical project version `1.0.3`.

## v1.0.2 editor save/close reliability

Fixed the editor-window close crash by capturing the window WebContents ID before destruction and using the cached ID in the `closed` cleanup handler. Delayed geometry-save callbacks now bail out after the window context is marked closed.

## Verification boundary

The source and static tests can be checked in the development container, but this environment currently cannot reach the npm registry and has no Windows Electron desktop. Therefore a real Monaco bundle build, Windows EXE build, and live SSH/SFTP GUI end-to-end test have **not** been completed in this response. The first Windows build will verify package paths and bundler compatibility; then test independent windows, Monaco workers, paste/Enter/Tab behavior, save/conflict/recovery, and your existing SSH terminal before relying on important remote configuration changes.
