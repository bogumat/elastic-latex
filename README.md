# Elastic

A local LaTeX editor for macOS. This repository contains the first working performance prototype described in [ARCHITECTURE.md](ARCHITECTURE.md).

## Run

Prerequisites: Node.js 22.12+ (tested with 25.2.1), a current stable Rust toolchain, Xcode Command Line Tools, and a local TeX installation with `latexmk` and `pdflatex`. MacTeX's `/Library/TeX/texbin` is discovered even when the app is launched from Finder.

```sh
npm ci
npm run tauri -- dev
```

Open `tests/fixtures/article` in the app for a small multi-file example. Select a root document, edit, and press **⌘ S** or **⌘ Enter** to save all open documents and compile. Compilation waits for pending image pastes and successful saves. If TeX is unavailable or no root is selected, ⌘ S still saves and explains what is needed to compile. Ordinary edits autosave after 750 ms, with a five-second maximum interval during continuous typing. Saves are deferred while a build is reading the project; the status bar makes this explicit.

```sh
npm run tauri -- build --bundles app
open src-tauri/target/release/bundle/macos/Elastic.app
```

The local `.app` is unsigned and not notarized for distribution. `npm run dev` alone opens a clearly labelled browser sample with in-memory files; filesystem access and compilation require the desktop app.

The development session that created this prototype used an isolated temporary Rust installation. If it still exists, the equivalent command is:

```sh
PATH=/private/tmp/elastic-cargo/bin:$PATH \
RUSTUP_HOME=/private/tmp/elastic-rustup \
CARGO_HOME=/private/tmp/elastic-cargo \
npm run tauri -- dev
```

Install your own normal Rust toolchain for ongoing development; `/private/tmp` is not durable storage.

## Implemented

- Open ordinary project folders; expand directories on demand and browse a bounded file-list viewport.
- **Add file** and **Add folder** create entries from paths relative to the project root, reveal their parent folders, and open new files. Parent folders must already exist; existing entries are never overwritten.
- Paste clipboard images into `.tex` source to save a unique PNG under `images/` and insert a `figure` with `includegraphics`. The selected root receives `usepackage{graphicx}` if needed.
- Paste spreadsheet HTML/tab-separated cells or Markdown pipe tables as editable LaTeX `tabular` environments, with escaped special characters. **⌘ Shift V** bypasses conversion for plain text.
- **Open Folder…** selects a working folder; **Close working folder** returns to the welcome screen. The last eight folders are remembered locally, with five shown on the welcome screen.
- **Clone from GitHub…** accepts a repository URL and a parent folder, optionally forks first, and opens the completed clone.
- **Git** opens source control: branch/tracking state, remotes, changed files and text diffs, initialization, commit-all, fetch, fast-forward pull, push, and personal GitHub forks.
- Edit UTF-8 LaTeX/BibTeX source in CodeMirror, with syntax highlighting, completions, find/replace, line numbers, and retained tab selections/undo history.
- Revision-aware autosave, atomic replacement, preserved LF/CRLF and file permissions, and pre-write external-change checks. Failed writes keep edits dirty. Closing the window and switching projects flush pending saves.
- Explicit root selection. Prefer `main.tex`, otherwise automatically choose only a single top-level candidate. If there are several, open the desired source and select it in **Root**.
- Local `latexmk`/pdfLaTeX compilation, cancellation of the process group, a 120-second timeout, bounded logs, and file/line diagnostics.
- Incremental build directories and stable successful PDF artifacts. Failed/cancelled builds retain the previous preview; edits during compilation mark the result out of date.
- Locally bundled PDF.js worker/resources, continuous scrolling with offscreen canvas eviction, selectable text, page navigation, zoom, fit width, and PDF export.
- Double-click PDF text or images to open the matching `.tex` source line using SyncTeX. PDF-only view switches to Split so the source is visible. Recompile after source changes for accurate navigation.
- Collapse environments, multiline brace groups, and section contents using the arrows beside source line numbers; click the folded placeholder to expand again. Folding only affects display; hidden text is still saved and compiled.
- Source/split/PDF views and a keyboard-accessible source/preview divider.

## Prototype limits

This is the initial vertical slice, not the first complete release. It does **not** yet provide crash recovery, general external-change watching/reloading or a conflict-resolution UI, persisted editor sessions/preferences, template-based project creation, file rename/delete, tab closing, toolchain selection, or automatic compilation. Git pulls explicitly refresh open buffers, and recent working folders are persisted. A save conflict retains your buffer and reports the error; copy valuable unsaved text elsewhere before closing/reopening to resolve it. Force quit and crashes can still lose unsaved edits, including edits held during a build or Git action.

Clipboard images are normalized to PNG locally, limited to 20 MiB and 32 megapixels, and referenced relative to the project root used by the compiler. Undo removes the inserted source but retains the image asset. Table conversion preserves cell values rather than spreadsheet formulas or styling; merged HTML cells become a rectangular grid with blank covered cells. Markdown column alignment is preserved. Tables over 10,000 cells and malformed text tables fall back to normal text paste. Image-only screenshots of tables remain images; OCR is not included. Tables use standard `tabular`, so wide/long tables may need manual layout adjustments.

The preview compares editor revisions and the selected root; external programs can still change compiler inputs without detection. The preview does not expose PDF annotations/forms. SyncTeX maps positions to source lines rather than exact characters; custom macros or figures can map to a nearby defining line. Recompile PDFs made before this feature to publish their matching SyncTeX map. Source files are limited to 16 MiB. Full logs rotate in the managed build directory (32 MiB maximum per build); the UI keeps a 64 KiB tail. Incremental caches live in the OS application-cache directory for `dev.elastic.editor`; cache-wide quota eviction remains to be implemented. The latest PDF and SyncTeX artifact pair replaces the previous pair, but orphaned artifacts after an interrupted session are not yet scavenged.

Compile only trusted projects. Shell escape and automatic latexmk configuration loading are disabled, but the external TeX process is not a filesystem sandbox. Editing, compilation, and preview make no network requests; dependencies and TeX packages must already be installed for offline operation. Git remote actions and GitHub account/fork actions use networking only when requested.

## Working with GitHub

1. Choose **Clone from GitHub…** on the welcome screen or **Clone…** in a workspace. Paste `https://github.com/owner/repository` (SSH URLs also work), choose its parent folder, and confirm the new working-folder name. Existing folders are never overwritten.
2. For private HTTPS repositories, Elastic reuses configured Git credential helpers and adds installed GitHub CLI as a per-command fallback. Forking requires GitHub CLI. If needed, install `gh` and run `gh auth login --hostname github.com` in a terminal once; **Check GitHub sign-in** verifies that connection. Elastic does not implement its own login/token storage. SSH clones use your SSH agent and known-host configuration.
3. In **Git**, review the changed-file list/diffs, enter your own message, and choose **Commit all changes**. This stages all current non-ignored changes. Git must already have your `user.name` and `user.email`; Elastic never substitutes an identity. Existing commit hooks and signing configuration are respected, so interactive hooks/signing may need terminal use.
4. Select a remote before **Fetch**, **Pull**, or **Push**. Pull targets the current branch on that remote, requires a clean working folder, and fast-forwards only. Push publishes existing commits to that same branch and establishes tracking. Counts describe the tracking branch as of the last fetch; unsaved/uncommitted changes are not published by Push.
5. **Fork on GitHub** creates your personal fork and adds it as `fork`, preserving `origin`. Select `fork` to push there. The fork-and-clone checkbox instead clones your fork as `origin` and connects the original repository as `upstream`.

Open the repository root to use source control; opening a subdirectory intentionally does not grant access to its enclosing repository's Git operations. There is no force push, auto-stash, destructive reset, granular staging, branch switcher, or automatic merge resolution. Resolve divergent branches/conflicts in a terminal or Git client and refresh. Git actions are cancellable and have a 180-second per-process timeout; failed/cancelled clone folders are retained, and a remote fork may already exist even if cloning fails. Check the reported paths before retrying.

Git actions flush pending saves first. While a pull updates files, source editing pauses; afterwards open buffers refresh and the previous PDF is invalidated. The same refresh runs after an interrupted pull. If reading refreshed files fails, existing buffers are retained and editing/builds remain paused until **Retry reload** succeeds. Other Git actions allow typing while deferring autosave until completion.

## Verification

```sh
npm test                       # Save ordering, conflicts, coalescing, build barrier
npm run build                  # Type checking and production bundle
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored  # Real local TeX test
npx playwright install chromium # One-time browser setup
npm run test:browser
npm run fixtures               # Generate synthetic 20-/300-page and large-source inputs
```

To use an existing Chrome installation for browser tests:

```sh
ELASTIC_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run test:browser
```

The browser tests use an explicit test-only IPC bridge for compile/Git results, plus the actual bundled PDF engine/worker. Rust integration tests exercise real latexmk and real Git against temporary local bare repositories. Fork tests use a fake GitHub CLI; they never create a real fork or push to GitHub. Tests cover malformed URLs, destination collisions, filenames/renames, commit/push/pull, divergence, cancellation, recent-folder history, and buffer reconciliation. A native packaged-app smoke test has also verified project opening, multi-file compilation, and PDF display.

For bounded editor transaction samples, load the browser sample with `?perf=1` and call `window.elasticPerformance()` in developer tools. These timings measure synchronous JavaScript work, not input-to-visible-character latency. Release acceptance requires the native measurements described in [the baseline record](tests/performance/BASELINE.md).

## Structure

`src/app` composes the shell; `src/features` contains isolated editor/project/preview/Git adapters; `src/shared/contracts` defines workspace IPC types. Rust `projects`, `builds`, `git`, and `persistence` modules own files, processes, repository operations, and recent folders; `lib.rs` and `commands` expose Tauri commands. Tests cover risk-bearing persistence/process logic rather than UI implementation details.
