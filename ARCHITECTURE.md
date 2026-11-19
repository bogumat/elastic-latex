# Offline LaTeX Editor — Architecture Proposal

**Status:** Performance review completed; core prototype implementation started on 19 November 2026 at the user's request. The release performance gate remains open. See `README.md` for implemented functionality and `tests/performance/BASELINE.md` for measured evidence and remaining checks.

**Working name:** Elastic. This is a placeholder based on the project folder.

**Performance priority:** Immediate editing response takes precedence over background work. The stack remains provisional until the performance prototype in section 6 passes its acceptance targets.

## 1. Product direction

Build a local desktop LaTeX editor with the familiar Overleaf workflow: project files on the left, source in the middle, and the compiled PDF on the right. The interface should feel quiet, clear, and practical.

The central workflow is: **open a folder → edit LaTeX → compile locally → inspect the PDF → fix errors.**

### Design principles

- Make writing, compiling, and finding errors immediately understandable.
- Use grey-blue surfaces, restrained accents, clear typography, and predictable controls.
- Keep files in ordinary folders that work with other editors and existing version control.
- Keep saving and compilation states explicit. Users should always know whether their changes are saved and whether the PDF is current.
- Keep modules small and give filesystem access, compilation, editing, and previewing clear boundaries.
- Give typing, cursor movement, scrolling, and pane interaction priority over previewing, indexing, and compilation. Measure this under concurrent load, not just in an empty editor.

## 2. Proposed defaults to review

These are the starting defaults for the prototype. Platform and stack choices remain subject to the performance gate.

| Decision | Proposed starting point |
| --- | --- |
| Application type | Installed desktop app |
| Initial platform | macOS; keep platform-specific code isolated for later Windows/Linux support |
| Project model | One local project folder per window; start with one window |
| Editing model | LaTeX source with PDF preview |
| Initial compiler | pdfLaTeX, coordinated by latexmk |
| TeX distribution | Existing local TeX Live installation, including MacTeX on macOS |
| Saving | Autosave after a short pause, plus an explicit Save action |
| Compilation | Manual by default; optional automatic compilation once the manual workflow is reliable |
| Appearance | Light theme with grey-blue application chrome |
| Runtime connectivity | Editing/compilation stay offline; explicitly invoked GitHub and remote Git actions use networking |
| Performance gate | Benchmark the editor, preview, and compiler together before building the full feature set |

### What “offline” means

After installation and toolchain setup, users can create projects, edit, compile, inspect errors, preview, and export PDFs with networking disabled. Bundle interface assets, fonts if used, PDF workers, and starter templates locally. No account, hosted compiler, remote fonts, CDN dependency, analytics, or cloud storage is needed.

**The first version requires a separately installed TeX distribution and the packages needed by the document.** It is not initially a self-contained TeX installer. Missing packages produce a useful error rather than triggering a download. Initial developer dependencies and TeX setup may require internet access or offline installers.

## 3. Initial scope

### First usable version

- Create a project from a small bundled article template, or open an existing folder.
- Browse files and folders; create, rename, and delete files with appropriate recovery/confirmation for destructive actions.
- Edit `.tex` and `.bib` files in tabs, preserving selection, scroll position, and undo history when switching tabs.
- Provide syntax highlighting, line numbers, indentation, bracket matching, comment toggling, find/replace, and a small set of command/environment completions.
- Compile the selected root document locally; show progress and offer cancellation.
- Display the generated PDF with zoom, fit-width, page navigation, text selection, and export.
- Show useful compiler diagnostics with file/line navigation and access to the full log.
- Autosave, show save failures, and recover unsaved buffers after an interrupted session.
- Detect external file edits and offer a clear conflict resolution flow.
- Remember recent projects, open tabs, pane sizes, and essential preferences locally.
- Open a working folder, reopen recent folders, or clone a GitHub repository into a user-selected parent folder. Git controls were added to scope by explicit user request on 19 November 2026.
- Inspect Git status/diffs, commit local changes, fetch, fast-forward pull, push to a selected remote, and create a personal GitHub fork.

### Later improvements

- Project-wide search and a document outline.
- Source-to-PDF and PDF-to-source navigation through SyncTeX.
- XeLaTeX and LuaLaTeX engine choices.
- Richer bibliography, label, citation, and reference completion.
- Optional automatic compilation and additional bundled templates.
- Windows/Linux distribution and an optional bundled offline toolchain.
- Dark theme if requested.

### Outside the initial scope

Real-time collaboration, automatic cloud sync, Elastic accounts, AI assistance, visual rich-text editing, a plugin marketplace, and a large template gallery. This is NOT a product - but a labour of love. GitHub integration uses the user's existing Git/SSH credentials or GitHub CLI account.

## 4. Workspace and interaction design

### Main layout

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Project name       Open…         Root: main.tex    Compile    Export PDF │
├──────────────┬────────────────────────────┬──────────────────────────────┤
│ Files        │ main.tex  references.bib    │ PDF       −  Fit width  +    │
│              ├────────────────────────────┤                              │
│ main.tex     │  1  \documentclass{article} │       Compiled page          │
│ sections/    │  2  \begin{document}        │                              │
│ figures/     │  3                          │                              │
│ refs.bib     │                            │                              │
│              ├────────────────────────────┴──────────────────────────────┤
│              │ Problems (2) | Build log                   [collapsible] │
├──────────────┴───────────────────────────────────────────────────────────┤
│ Saved                                  PDF up to date       Ln 3, Col 1 │
└─────────────────────────────────────────────────────────────────────────┘
```

- Start with a roughly 220 px file sidebar; divide remaining space evenly between source and preview. Both dividers are adjustable.
- Support **Split**, **Source**, and **PDF** views. On narrow windows, make switching views easy instead of squeezing every pane.
- Keep Compile in a stable position. While running, expose Stop and show progress as text.
- Keep the problems/log panel collapsed when there is nothing to act on. Reveal errors after a failed build without taking keyboard focus from the editor.
- Use a compact toolbar with text labels for primary actions. Secondary icon buttons need tooltips and accessible names.
- Avoid decorative dashboards, oversized cards, gradients, glass effects, floating controls, and unnecessary animation.

### Essential flows

**First launch:** show Create Project and Open Folder, recent projects if present, and a toolchain status. If TeX is unavailable, allow editing and explain how to select an installed toolchain. Compile remains unavailable with a visible reason.

**Open an existing project:** choose a folder and identify likely root documents. Prefer `main.tex` when appropriate; ask the user to choose when multiple plausible roots exist. Save that choice as project configuration. Compilation always uses this root, not whichever tab is active.

**Edit and save:** autosave after approximately 750 ms of inactivity; `Cmd/Ctrl+S` saves immediately. Show Unsaved, Saving, Saved, or Save failed. Never clear the unsaved state before a write succeeds.

**Compile:** save all modified project buffers before starting. If saving fails or an external-edit conflict is unresolved, explain why compilation cannot proceed. Keep editing responsive during the build.

**Fix an error:** present a readable message, file, and line where reliably available. Clicking it opens the file and highlights the location. Preserve the raw log for diagnostics that cannot be parsed confidently.

**Failed build:** retain the last successful PDF and label it as an earlier result. A failed build must never make an older PDF appear current.

### Keyboard and accessibility

- Use platform conventions for Open, Save, Find, Replace, and tab navigation; use `Cmd/Ctrl+Enter` for Compile.
- Make panes, file actions, tabs, and build controls keyboard accessible with visible focus.
- Keep status messages readable by assistive technology and avoid announcing every build-log line.
- Use text and icons alongside status colours. Verify normal text contrast of at least 4.5:1 and visible control/focus contrast during implementation.
- Respect system text scaling and reduced-motion preferences.

## 5. Visual system

Use semantic CSS variables so colours and spacing can be adjusted centrally.

| Token | Proposed value | Use |
| --- | --- | --- |
| `background` | `#F3F5F7` | Main application background |
| `surface` | `#FFFFFF` | Source editor, inputs, document paper |
| `surface-muted` | `#E8EDF2` | Sidebar and toolbar |
| `border` | `#CFD7E0` | Pane dividers and quiet separators |
| `text-primary` | `#253242` | Main text |
| `text-secondary` | `#566579` | Secondary labels |
| `accent` | `#486581` | Primary actions and focus indicators |
| `selection` | `#DCE7F2` | Selected files and editor selection |
| `success` | `#35654B` | Successful build status |
| `warning` | `#795719` | Warnings |
| `error` | `#A33A3A` | Errors and failed saves |

- Use the system UI font and a locally available monospace font for code. Start near 13–14 px for interface text and 14 px for source, with configurable editor size.
- Use a 4 px spacing scale, modest 4–6 px control radii, and thin separators. Reserve shadows for menus and dialogs.
- Keep the source editor light, with restrained syntax colours; use grey-blue around the PDF and white for its paper.
- Use a small, consistent set of outline icons bundled with the app.
- Validate contrast for actual component states; the palette alone is not accessibility verification.

## 6. Proposed technical architecture

### Stack

| Layer | Proposal | Reason |
| --- | --- | --- |
| Desktop shell | Tauri 2, subject to the performance gate | Desktop web UI with a Rust boundary for local system operations |
| Interface | React + TypeScript + Vite; React owns workspace controls only | Keep document transactions and PDF rendering independent of workspace rendering |
| Styling | Plain CSS with shared tokens | Direct control over a restrained design without a large UI framework |
| Source editor | CodeMirror 6 | Modular editor extensions and control over editor behaviour |
| PDF preview | PDF.js, bundled locally | Render PDFs inside the workspace with application-specific controls |
| Local services | Rust modules inside the Tauri app | Filesystem, settings, file watching, toolchain discovery, and child-process management |
| Build orchestration | latexmk with local pdfLaTeX | Coordinate the repeated compilation passes needed by LaTeX documents |
| Persistence | Files and small versioned JSON records | Keep project contents portable and avoid an unnecessary database |

These are proposed choices. Tauri documents its separation between the WebView and Rust core in its [process model](https://v2.tauri.app/concept/process-model/). CodeMirror describes its extension and language packages in its [documentation](https://codemirror.net/docs/). PDF.js exposes rendering layers suitable for a custom preview in its [getting-started guide](https://mozilla.github.io/pdf.js/getting_started/). latexmk's role is described in its [CTAN package documentation](https://ctan.org/pkg/latexmk).

LaTeX highlighting and completion need an explicitly selected and validated CodeMirror extension; do not assume a complete first-party LaTeX language service is included. Start with basic highlighting and curated snippets, and keep this adapter replaceable.

### Responsibilities and boundaries

```text
React workspace
  ├── project explorer
  ├── CodeMirror editor adapter
  ├── PDF.js preview adapter
  └── problems, build controls, and settings
             │ typed commands / events
Rust application services
  ├── project and filesystem service
  ├── settings and recovery service
  ├── file watcher
  ├── toolchain discovery
  └── build manager ──> latexmk ──> installed TeX tools
```

- UI components handle presentation and interaction, not raw filesystem access or process execution.
- Keep editor text and undo state in CodeMirror. React stores workspace metadata and subscribes to changes; do not replace the entire editor document on each keystroke.
- Use narrowly scoped state subscriptions. A keystroke must not rerender the explorer, preview, or application shell. Share stable service references through context; keep frequently changing state local or expose selector-based subscriptions.
- The Rust build manager owns process lifecycle, logs, cancellation, build IDs, and successful artifacts.
- Deliver each completed PDF through a narrowly scoped binary response, identified by build ID. Avoid base64, JSON byte arrays, and repeated whole-file transfers. Do not expose arbitrary filesystem paths to the WebView. Add scoped range delivery only if large-file measurements justify it.
- Bundle the PDF worker, rendering resources, and other assets; avoid runtime remote asset loading.
- Use commands for requests and events for build/watch updates. Identify updates by project and build ID so late messages cannot affect a different project or newer build.

### Performance targets and measurement

Treat these as initial acceptance targets, not measured results or guarantees. Start with an Apple Silicon Mac with 16 GB RAM and local SSD; record the exact model, macOS version, display refresh rate, app version, and TeX distribution for every baseline. Revisit targets if a different minimum machine is chosen.

| User-visible operation | Initial target |
| --- | --- |
| Launch to an editable restored document | Cold launch ≤ 1.5 s; warm launch ≤ 750 ms for the ordinary fixture |
| Typing to visible character | p95 ≤ 32 ms on a 60 Hz display, including while compiling and scrolling a PDF |
| Synchronous application work per keystroke | p95 ≤ 4 ms; no full-document copy, project scan, or IPC round trip |
| Switch to an already loaded source tab | p95 ≤ 50 ms |
| Open a 1 MiB source file | p95 ≤ 150 ms from the open request to editable text; excludes the file picker |
| PDF update after a successful build | p95 ≤ 300 ms from artifact publication to the first visible page for the ordinary fixture |
| Scroll and resize | Meet the 16.7 ms frame budget on a 60 Hz display for at least 95% of frames |
| Idle activity | Average app CPU below 1% of one core over 60 s after work settles; no periodic project scans |
| Steady-state app memory | Target ≤ 300 MiB ordinary / ≤ 512 MiB stress workload; no sustained growth across repeated builds |

Measure release builds with developer tools closed for acceptance runs. Include the Rust host, WebView processes, and workers in app-memory totals; report compiler CPU/memory separately. State the memory metric used and collect peaks as well as settled usage. Report cold and warm results separately with sample counts and p50/p95; use at least 20 launch samples and 200 interactive samples. Verify visible latency with platform traces; label requestAnimationFrame-based timing as an approximation.

Use two repeatable workloads:

- **Ordinary:** a 20-page paper, bibliography, several images, 20 source files, and five open tabs.
- **Stress:** a 300-page thesis PDF, a 1 MiB/approximately 50,000-line source file, 2,000 project entries, a large bibliography, and ten open tabs. Include separate long-line and image-heavy cases; line count alone is insufficient.

Compile time depends on the document and TeX toolchain. Benchmark a clean build, an incremental build, and an unchanged build against direct latexmk invocation with identical options and cache state. Target app orchestration overhead ≤ 100 ms or 10% of direct build time, whichever is larger; report save time, compiler time, artifact publication, and preview time separately. Do not promise instant compilation of arbitrary LaTeX.

### Startup and loading order

- Keep the welcome screen, editor workspace, and PDF engine in separate dependency graphs. Opening the app without a project must not parse CodeMirror or PDF.js. Loading an editable document must not import the PDF engine, its worker, or viewer styles.
- Startup has one critical path: render the shell, resolve the selected/restored root, read the active source, mount the editor. Load other tab contents on demand. Toolchain discovery, expanded directories, recovery inspection, and preview restoration must not delay editable text; recovery decisions must still precede replacing a buffer that has recoverable changes.
- Start cached toolchain discovery alongside the shell. Preload the PDF adapter when compilation starts; create its worker only when an artifact is available. Avoid recurring idle polling.
- Import only the PDF text-layer styles required by the custom viewer. Do not ship the stock viewer's annotation editor, sidebar, and toolbar styles into the initial page. Keep any extracted upstream styles attributed and pinned to the installed PDF.js version.
- Record initial JavaScript and deferred asset sizes alongside timing measurements. Smaller bundles are evidence of reduced loading work, not a substitute for cold-launch and input-latency measurements.

### Protect the editing path

- CodeMirror owns document edits synchronously. A transaction may update a revision counter and dirty flag; saving, parsing the project, and completion indexing happen later.
- Use CodeMirror's viewport rendering and incremental facilities. Limit custom highlighting/decorations to relevant changes and visible ranges. No full-document regular expression scan on each edit. Its [system guide](https://codemirror.net/docs/guide/) explains viewport rendering.
- Keep one mounted EditorView for the active source pane and retain EditorState per open tab. Do not mount hidden editor views. Retain dirty documents and undo histories; bound optional history/cache growth without silently dropping unsaved work.
- Debounce completion/index updates and run expensive custom analysis in a worker or Rust background task. Apply results only if document revisions still match. Initial snippets need no project-wide analysis.
- Debounce autosave and recovery writes, coalesce obsolete queued saves, and serialize a document only when a save is due. Give continuous typing a maximum save interval of approximately five seconds. A save must never block the next input event; profile large-file serialization before introducing a more complex patch protocol.
- Treat saving as a per-file revisioned queue: a successful write acknowledges only the revision it serialized. Edits arriving during that write remain dirty, and the following write uses the returned disk version. Deduplicate concurrent opens so two requests cannot create competing editor states for one file.
- Implement pane dragging through animation-frame updates and CSS sizing. Persist divider positions on drag end rather than writing settings on every pointer movement.

### Bound PDF work

- Lazy-load PDF.js after the editor is interactive. Preload during idle time or compilation when a preview will be needed; opening a project must not wait for the PDF engine.
- Use its bundled worker for supported parsing/decoding work. Canvas painting and text-layer work still need explicit scheduling; a worker does not remove all UI-thread costs.
- Render visible pages first, with at most one neighbouring page prefetched on each side. Start with one active render task and raise concurrency only after measurement.
- Keep distant pages as lightweight placeholders. Build text/annotation layers only for visible pages and preserve text selection, navigation, and accessibility when recycling page views.
- Start with a 64 MiB budget for cached completed page canvases, with separate accounting for in-flight rendering and PDF document data. Evict least-recently-used offscreen canvases, cancel obsolete renders, and release replaced PDF documents/workers. Bound render resolution at extreme zoom and refine visible content after interaction settles.
- For the first prototype, use a single-page paginated viewport with previous/next navigation rather than implementing continuous scrolling immediately. Limit each canvas to 8,388,608 pixels (32 MiB RGBA), including the retained page plus its replacement in the 64 MiB budget. Add continuous virtualization and neighbour prefetch only after the baseline; PDF document/worker memory is a separate budget.
- During zoom and divider dragging, transform the existing page temporarily and rerender at the settled size. Preserve a correctly labelled earlier preview until the replacement's visible page is ready.
- Reserve vertical scrollbar space in the PDF viewport so fit-width rendering cannot alternate between widths as page height crosses the scroll threshold. Keep horizontal scrolling available at fixed zoom levels.
- Pause rendering when the PDF pane or window is hidden. Never render an entire thesis just to open its first page.

PDF.js discusses both [visible-page rendering and raw binary delivery in its FAQ](https://github.com/mozilla/pdf.js/wiki/Frequently-Asked-Questions). Tauri supports [raw binary command responses](https://v2.tauri.app/develop/calling-rust/#returning-data). Validate the selected PDF.js build and worker on the minimum supported macOS WebView during the prototype.

### Keep background work bounded

- Read only visible/expanded directories initially; load file contents when opened. Virtualize large tree lists and logs. Exclude generated output, version-control internals, and irrelevant cache directories from scanning.
- Use filesystem notifications with coalesced changes. Rescan affected directories when required, including notification overflow, rather than polling the entire project.
- Use asynchronous I/O and bounded Rust background tasks for scans and log parsing. Blocking work must not occupy the UI thread or hold a shared application-state lock during disk access.
- Stream full logs to disk, send UI batches at most approximately ten times per second, and retain a bounded visible tail. Preserve terminal status/errors even when intermediate progress is coalesced; roll logs between builds with a disk quota.
- Keep one compiler tree active and at most one pending request per project. Defer speculative indexing/prefetch while typing or compiling. Avoid speculative background tasks that consume every CPU core.
- Reuse the project watcher and PDF worker where safe; use no recurring timers or workers when there is no work.

### Stack decision and early performance gate

The current stack is a candidate, not proof of speed. Keep React out of editing/rendering internals and benchmark the actual application before considering a framework replacement. Small installer size does not establish low input latency or low runtime memory.

Before implementing the full explorer, recovery, or settings flows, build a minimal release-mode vertical slice: one source editor, one local compile command, a virtualized PDF preview, and latency/memory instrumentation. Test typing while compiling, replacing PDFs repeatedly, and navigating the stress fixture.

If a target fails, capture a trace and fix the measured bottleneck. If WebView/PDF rendering remains the limiting factor after focused fixes, evaluate a macOS-native implementation using AppKit/TextKit and PDFKit before committing to the rest of the UI. Native code also requires benchmarking and introduces editor-development and platform-portability costs. Do not build both implementations speculatively.

## 7. Files, saving, and persistence

### User project structure

```text
my-paper/
  main.tex
  sections/
  figures/
  references.bib
  .elastic.json       # Optional portable settings: schema version, root, engine
```

- The folder is the project. Existing projects must open without conversion or a mandatory manifest.
- Keep generated PDFs, auxiliary files, and logs in an application-managed build directory keyed by project identity. Export only the requested final PDF to a user-selected destination.
- Keep a stable working build directory across compiles so latexmk can reuse dependency records and auxiliary outputs. Key/invalidate it by root document, engine, toolchain, and relevant options; do not create a fresh empty output directory for every build. Use build IDs for published preview artifacts. Apply an approximately 1 GiB configurable disk-cache quota between builds, preserving active outputs and the latest successful preview.
- Put recent-project paths, pane sizes, editor preferences, and recovery records in the operating system's application-data directory. Do not write personal absolute paths into portable project configuration.
- Preserve existing line endings and encoding where supported; use UTF-8 for new files. Warn before editing unsupported encodings rather than silently damaging text.
- Serialize writes per file and use temporary-file replacement where supported. Preserve file permissions and retain dirty buffers if writing fails.
- Track file versions so a delayed save cannot overwrite a later edit. Use external-change detection and a pre-write version check to avoid silently replacing another program's changes.
- Auto-reload externally modified clean files. For dirty files, offer compare/reload or explicitly keep local changes. Keep a recovery copy before discarding a buffer.
- Recover interrupted work from bounded local recovery records; do not promise a complete version-history system.
- Support assets inside the selected project root initially. Reject application file operations that escape it, including symlink escapes; external dependencies are a later compatibility decision.

## 8. Local compilation lifecycle

1. Discover the configured toolchain and check required executables, including latexmk's runtime dependencies. Support selecting its location because desktop applications may not inherit terminal PATH settings.
2. Resolve the project root document, validate configuration, and save pending changes.
3. Start one build per project using explicit process arguments, with the project folder as the working directory and output directed to its managed build directory.
4. Stream bounded logs and structured status events without blocking editing. Avoid running latexmk's continuous-watch mode; the application owns build scheduling.
5. On successful exit with a valid PDF, publish a completed artifact for that build ID. Preview a stable copy rather than a file still being written by the compiler.
6. Update diagnostics and preview while preserving the user's page and zoom where possible.
7. Compare document revisions with those at build start. Edits made during compilation leave the result marked as out of date.

**Build input consistency:** after flushing pending saves, suspend ordinary disk autosaves until the compiler process tree exits. Keep accepting edits in CodeMirror, then resume autosaving the latest revisions. Otherwise a multi-file TeX build can read a mixture of revisions even when its final PDF is labelled stale. Recovery writes, once implemented, must continue to their separate application-data location during compilation. The ordinary five-second save target excludes an active build; show the deferred-save state explicitly. External tools can still change files during the build, so this is not an immutable filesystem snapshot. A watcher must invalidate freshness on external changes; consider a measured copy-on-write staging strategy only if strict reproducibility becomes a requirement.

Preserve latexmk's incremental dependency checks; do not force a clean rebuild on each request. Let latexmk validate whether saved dependencies changed rather than relying only on the active editor's revision. Cache toolchain discovery and rerun it on configuration changes or an executable failure, not on every Compile click. Keep directory scans and unrelated analysis out of the build-start path.

Build states: **Idle → Saving → Building → Succeeded / Failed / Cancelled**. PDF freshness is tracked separately: **No preview / Up to date / Out of date / Earlier successful build**.

Cancel terminates the build process tree, including compiler children. Apply a configurable timeout and report timeouts clearly. Never start overlapping builds for the same project. A later auto-compile mode should debounce changes and keep only one pending rebuild.

Use noninteractive compiler behaviour and file/line error output. Disable TeX shell escape and automatic latexmk configuration loading in the initial managed workflow; do not accept arbitrary build commands from project settings. Missing packages and unsupported build customisations must produce actionable messages.

The application filesystem boundary does not sandbox the external TeX process. The initial compiler workflow targets trusted local projects; a restricted compiler sandbox would be a separate architectural addition.

## 9. Proposed repository structure

### Working folders and Git — implemented extension

- A selected ordinary folder remains the project identity. Recent folder paths are bounded to eight entries in a versioned app-data JSON file. Closing/switching folders flushes pending edits; cloning creates a new folder and opens it only after the clone completes.
- Source control and clone UI modules load on demand. No Git polling, authentication check, fetch, or remote call runs on the editor startup/typing path. Status refreshes are explicit and bounded; large changed-file lists are paginated.
- A Rust Git service runs the installed `git` and, for GitHub account/fork operations, `gh`, with explicit arguments, disabled terminal prompting, bounded output, a 180-second per-process timeout, and process-group cancellation. It does not write tokens into project files or change global Git configuration. Git's normal user identity and commit hooks remain in force; Elastic adds no authors or commit trailers.
- Cloning accepts canonical GitHub HTTPS/SSH repository URLs and refuses existing destination folders. Failures retain the destination for inspection. Creating a GitHub fork is a separate remote side effect; errors explain when the fork may already exist. Brief asynchronous fork-not-found responses may be retried only into an empty destination.
- Git operations require opening the repository's working-tree root, avoiding accidental commits to an enclosing repository. Detached HEAD, conflicted index, merge/rebase state, and non-fast-forward updates produce actionable errors. Pull requires a clean working tree and uses `--ff-only`; there is no automatic stash, reset, force push, or automatic conflict resolution.
- The selected remote and current branch determine pull/push targets. Push uses an explicit `HEAD:refs/heads/<branch>` refspec. Forking an open project adds a separate `fork` remote and preserves existing remotes; fork-and-clone uses the user's fork as `origin` and the original as `upstream`. The UI always requires an explicit Push action to publish commits.
- Git mutations share the backend operation lock with project switching/saving/build startup. The frontend flushes saves and suspends autosave during Git actions. Pull temporarily makes the editor read-only, then reloads all loaded clean buffers (including after failure/cancellation), closes deleted tabs, and invalidates the PDF. Failed refreshes keep old buffers and pause editing/builds until reload succeeds. Typing remains available during commit/fetch/push/fork while disk autosaves are held.
- General external-edit watching, full staging/unstaging, branch switching, merge resolution, GitHub Enterprise, and embedded OAuth are follow-up work. One-time GitHub sign-in currently uses `gh auth login --hostname github.com` outside Elastic; public HTTPS cloning requires no GitHub account.

Git's [stable porcelain status format](https://git-scm.com/docs/git-status) is parsed with NUL-delimited paths. Fork creation uses the [GitHub forks endpoint](https://docs.github.com/en/rest/repos/forks) through the authenticated GitHub CLI. Tests use local bare remotes and a fake GitHub CLI; they do not create real remote forks or push to GitHub.

```text
ARCHITECTURE.md
src/
  app/                 # Workspace composition, shared state, commands
  features/
    projects/          # Project opening and file explorer
    editor/            # CodeMirror adapter and LaTeX extensions
    preview/           # PDF.js adapter and preview controls
    build/             # Build controls, statuses, diagnostics, log panel
    settings/          # Preferences and toolchain setup
  shared/
    ui/                # Small reusable controls
    contracts/         # Backend command/event types
    styles/            # Tokens, typography, layout foundations
  assets/              # Bundled icons and templates
  performance/         # Timing probes and repeatable interaction scenarios
src-tauri/
  src/
    commands/          # Thin IPC entry points
    projects/          # Project metadata, file operations, watching
    builds/            # Toolchain adapter, process manager, log parsing
    persistence/       # Settings, session state, recovery
  capabilities/        # Minimum required desktop permissions
  tauri.conf.json
tests/
  fixtures/            # Small LaTeX projects and representative build logs
  performance/         # Workload generators, measurement scripts, baselines
```

Keep this as one application repository. Do not introduce microservices, a local HTTP server, a database, or a monorepo build system for the initial scope.

Restrict desktop permissions to the operations the app needs, following Tauri's [capability model](https://v2.tauri.app/security/capabilities/). Validate paths and arguments inside backend commands; UI validation alone is insufficient.

## 10. Implementation sequence and completion criteria

| Phase | Deliverable | Completion criterion |
| --- | --- | --- |
| 0. Performance prototype | Minimal source/compile/PDF vertical slice, ordinary and stress fixtures, release-mode measurements | Publish baseline results against section 6 targets; resolve failures or revise the architecture before expanding the app |
| 1. Foundation and visual shell | Tauri/React setup, tokens, resizable workspace, representative sample content | Native app opens; layout is usable at common laptop sizes and entirely keyboard navigable |
| 2. Real local editing | Open/create project, file tree, tabs, editor, autosave, recovery, external-change handling | A multi-file project survives edits, tab switches, restart, and a simulated save failure without silent data loss |
| 3. End-to-end compilation | Toolchain setup, root selection, build manager, PDF preview, diagnostics, export | A real local article compiles; an intentional error navigates to source; an earlier PDF remains correctly labelled after failure |
| 4. Reliability and first release | Cancellation, timeout handling, session restore, accessible states, packaging | Packaged build passes performance targets and, with networking disabled, can create, edit, compile, preview, and export using a prepared local toolchain |
| 5. Further editing assistance | Outline, project search, SyncTeX, extra engines, optional auto-compile | Add incrementally after the core workflow is dependable |

### Verification approach

- Unit-test risk-bearing logic: path containment, save ordering/conflicts, root selection, diagnostic parsing, and build-state transitions.
- Integrate against small real TeX fixtures: valid document, multi-file includes, bibliography, missing package, malformed source, and paths containing spaces or non-ASCII characters.
- Verify cancellation leaves no compiler children; a failed/cancelled build cannot publish partial output or replace a newer preview.
- Exercise missing-toolchain, read-only folder, external edits, restart recovery, and rapid consecutive edits during a build.
- Inspect the packaged macOS app, including PDF worker/resource loading, keyboard focus, text contrast, pane resizing, and offline operation.
- Use fixed fixtures and locally available packages so core automated tests do not depend on downloads.
- Run a short latency/memory smoke benchmark at each phase and the full matrix before release. Keep hardware-specific baselines; investigate a repeatable regression over 10% or any missed acceptance target before adding more features.
- Include at least 30 consecutive builds/PDF replacements and a sustained editing/scrolling run to detect leaked canvases, worker tasks, listeners, and unbounded histories. Record cold/warm build-cache results separately.

## 11. Review notes

### Performance review and prototype decisions — 19 November 2026

Retain Tauri, React, CodeMirror, and PDF.js for the prototype. The existing document already addresses the major hot-path risks: React-controlled editor text, eager PDF rendering, base64 IPC, repeated project scans, and discarded latexmk caches. A framework rewrite is not justified without a failing trace.

The implementation adds demand-loaded editor/PDF modules, a one-page bounded preview, serialized revision-aware saving, a build-time autosave barrier, lazy directory expansion with a bounded row window, 100 ms log batches, and a reusable compiler output directory. The backend rejects path/symlink escapes and publishes immutable PDF copies only after successful compilation.

The first native workflow has been exercised in the packaged macOS app: open a local multi-file article, load source, compile with installed latexmk/pdfLaTeX, and display the locally bundled PDF.js preview. This is a prototype, not completion of phases 0–4. Recovery, external-change watching/resolution, persisted sessions/settings, project creation/file management, complete cache eviction, and the release latency/memory matrix remain follow-up work. The subsequent working-folder/Git extension was explicitly requested by the user and is documented in section 9; its native performance gate also remains open.

Edit any section above directly. The choices with the greatest effect on implementation are:

- Whether macOS should be the first supported platform.
- Whether requiring an existing TeX installation is acceptable for the first version.
- Whether pdfLaTeX is sufficient initially or XeLaTeX/LuaLaTeX must be included immediately.
- Whether manual compilation and a light theme are the right defaults.
- Any essential Overleaf interaction missing from the first usable version.
- Whether the reference machine, latency/memory targets, and stress workloads reflect the projects we actually want to support.

**User edits / decisions:**

- 19 November 2026: add working-folder opening and GitHub URL cloning, pulling, pushing, and forking through Elastic.
