# Prototype validation — 19 November 2026

**Performance gate: open.** The checks below establish a working prototype and reduced loading work. They do not establish the architecture's native launch, latency, CPU, or memory targets.

## Build evidence

Node 25.2.1, Rust 1.100.0, Tauri 2.12.7, Vite 7.3.8, PDF.js 5.7.284, latexmk 4.88; macOS 26.6 (25G72). Exact dependencies are pinned in the npm and Cargo lockfiles.

| Asset | Initial implementation | After loading review |
| --- | ---: | ---: |
| Initial shell JavaScript, minified | 620.56 KB | about 245 KB |
| Preview CSS, minified | 280.13 KB | 2.88 KB |
| PDF engine JavaScript, deferred | 417.11 KB | about 417 KB |
| PDF worker, deferred | 1,232.30 KB | 1,232.30 KB |

Sizes are Vite's decimal KB, not measured transfer or startup times. The shell now defers roughly 365 KB of CodeMirror/document code plus the workspace until opening a project. PDF engine/worker/styles are absent from startup requests. The original core prototype app bundle measured 14.68 MiB.

## Checks performed

- TypeScript production build and native release/app packaging succeeded.
- Five frontend save-coordination tests: edit-during-save, failed writes, maximum debounce interval, build-time autosave suspension, and deduplicated opening.
- Five default Rust tests: path containment/version conflicts/line endings, symlink escape, diagnostic parsing, bounded Unicode logs, and process-tree cancellation.
- One real TeX integration test: successful compile, unchanged incremental cache reuse, deliberate error, diagnostics, and preservation of the previous published PDF. The filename contains both spaces and a dotted stem.
- Browser editing and layout tests passed in local Chrome: no eager PDF imports, preserved text/undo across tab switches, source view, keyboard divider adjustment, explicit selection of ambiguous roots, and clearing stale preview state when reopening a project.
- Thirty PDF replacements using real PDF.js and a test-only IPC bridge: one displayed canvas, at most one live worker after settling, selectable text, no third-party requests, and a failed build retaining its previous page. This is a bounded-object check, **not** a memory-leak proof or native stress benchmark.
- Packaged macOS UI: opened `tests/fixtures/article`, loaded its source, compiled the multi-file input, and visibly rendered the result. One cold compiler-cache smoke build reported **0.65 s** from the app build manager. This single small-document sample is not an acceptance measurement.

## Required before passing phase 0

Record exact hardware, refresh rate, memory accounting, and TeX distribution; collect at least 20 cold/warm launches and 200 interactive samples in the release app with developer tools closed. Measure ordinary and stress input latency while compiling and navigating PDFs, app/worker peak and settled memory across 30 builds, idle CPU over 60 seconds, and direct-latexmk versus app orchestration overhead.

`npm run fixtures` produces synthetic 20-/300-page projects, a 50,000-line source, a 1 MiB long-line source, and a directory with 2,000 entries. These are starting fixtures; add bibliography, image-heavy pages, and representative real-world content before claiming the complete ordinary/stress matrix has passed.

Use `?perf=1` only for the bounded JavaScript transaction probe. Platform traces are still needed for visible latency and frame pacing. Do not infer native WebView performance from headless Chrome results.

## Working folders / Git extension

The user-requested extension keeps source control off the startup path: clone UI is about 3 KB and the Git panel about 5.7 KB, both deferred. The initial shell is now about 246.3 KB (minified); no Git polling or authentication request runs at launch. The packaged app is about 15.17 MiB.

Validation now includes 13 passing Rust tests (including the real TeX test), seven frontend document tests, and seven browser tests. Real Git integration covers commits, local pushes/pulls, divergent history, process cancellation, and cloning into new folders using a test-only URL rewrite to a local repository. GitHub fork/account responses are simulated; no live GitHub fork or push was performed. Browser tests cover cloning from a pasted URL, explicit remote selection, recent-folder reopening, and editor reconciliation after successful/interrupted pulls. Native packaged-app checks verified Open Folder, Git initialization in an isolated temporary folder, changed-file status, and file-content review. The release latency/memory acceptance gate remains open.

## Fit-width scrollbar regression

Reproduced a resize feedback loop in Chrome with space-consuming scrollbars: a 520 × 650 px viewport alternated between 504 px and 520 px of available width, completing 11 additional page renders during a two-second idle observation. Reserving the vertical scrollbar gutter stops that loop; older WebKit uses `overflow-y: scroll` as a fallback. Two browser regression cases cover both CSS paths, idle render stability, fixed-zoom scrolling, returning to fit width, and resizing across the overflow threshold. These exercise real PDF.js with the test IPC bridge; the fallback is simulated in Chrome, not a minimum-version WebKit validation.

## Authoring and clipboard extension

Validation includes 16 passing Rust tests, 15 frontend tests, and 15 browser tests. New coverage checks exclusive file/folder creation, path containment, unique image assets, image limits, asynchronous paste position mapping, waiting for imports before saving/building, save/import failures, package insertion, and escaping spreadsheet/Markdown table contents. Clipboard events and Sheets HTML are synthesized in Chrome; they do not establish interoperability with every source application. The packaged native app visibly showed a pasted image asset, its generated figure and graphicx declaration, and a successful PDF render. Current package size is about 15.29 MiB; the initial shell remains about 246 KB and clipboard code loads with the workspace. The native latency/memory acceptance gate remains open.

## Continuous PDF preview, SyncTeX and source folding

The viewer now keeps page geometry for the whole document while painting only the visible range and one neighbour on each side. Canvas/text rendering is serialized and the pixel allowance is shared across displayed pages and replacements. A 40-page browser fixture verifies wheel scrolling, last-page access, page controls, zoom, canvas eviction and the canvas pixel cap. Fit-width scrollbar stability and thirty artifact replacements remain covered. These are object/pixel checks, not native CPU or process-memory benchmarks.

The real TeX integration suite verifies inverse SyncTeX for text and an image in an included source file whose name contains spaces; the immutable published map survives a later failed build. Browser tests verify opening the source line from PDF-only view and explaining missing maps. Source folding covers nested environments, multiline brace groups and sections, ignoring comments and verbatim contents. The native performance acceptance gate remains open.

Validation for this extension: 18 Rust tests (including real TeX/SyncTeX), 18 frontend tests, and 19 browser tests passed. TypeScript production build and macOS app packaging succeeded; the package is about 15.36 MiB.

## Sidebar file management

File operations are serialized with builds/Git, save all open buffers first, and pause source editing while paths change. Moves/renames retain buffer identity and undo history, remap descendant tabs and the selected root, and invalidate the PDF. macOS exclusive renames reject collisions; recursive copies stage privately before publication, reject symlinks/special files and enforce item/byte limits. Trash uses NSFileManager rather than permanent deletion. The native integration test moved a disposable fixture to macOS Trash and restored it, leaving the fixture cleanup to its temporary directory.

Validation includes 21 Rust tests (with the real TeX/SyncTeX and Trash cases), 20 frontend tests, and 23 browser tests. New browser coverage verifies dragging an edited root into a folder, renaming its parent, saving at the new path, Cut/Copy/Paste, Duplicate, keyboard file actions, path-copy dispatch, collision errors, saving before Trash, and closing removed tabs. Reveal in Finder and path copying are dispatched through the native backend; the browser bridge does not launch Finder or modify the system clipboard. The native performance acceptance gate remains open.

## Project-editor UI extension

Implemented and checked sequentially: editor tab management (safe close, middle-click, pinning and drag order), Quick Open, project-wide literal search/replace, sidebar sizing/hiding/reveal, multiple-file actions, source/section breadcrumbs and persistent editor settings. Search/index work is initiated by its dialog and runs off the native UI thread with explicit file/byte/result limits. Replacement uses document transactions and existing conflict-checked saves. Multi-file operations retain a single frontend busy lease; failures identify paths without undoing successful operations. Section tracking is debounced outside the synchronous typing transaction and cached per document revision.

The full integrated check passed 24 frontend tests, 23 Rust tests (including real TeX/SyncTeX and recoverable Trash) and 30 browser tests. Feature checks were also run separately before moving to the next feature. Dark-theme contrast was visually inspected from a browser screenshot, and the installed app is refreshed through `npm run build:app`. Browser IPC fixtures simulate project file/search data; native index/search tests exercise actual temporary files. Release startup/latency/process-memory acceptance measurements remain outstanding.

Production packaging succeeded at about 15.59 MiB, with an initial shell of about 247 KB minified. Quick Open, project search and settings dialogs remain deferred. These sizes are not native launch-time measurements.

## Independent PDF appearance and settings review

Settings is now application-wide (⌘, on the welcome screen and in a workspace), categorized, searchable and backed by a catalog. The review exposed existing editor line-number/highlight extensions, autosave timing, preview tabs, automatic file reveal, initial workspace layout and preview zoom as working preferences. App and PDF appearance each resolve independently, with System/Follow App support where applicable. The PDF canvas uses a display-only color filter; pages and embedded images are transformed together, while exports retain their original colors.

Tests cover migration of older preferences, catalog coverage, independent/system theme resolution, searchable categories, persistence, default layout/zoom, editor gutter/highlight controls, autosave delay and preview pinning. The browser check retained the identical canvas node and render-mark count, made only one artifact read, and preserved the scroll offset while changing appearance. The independent light-app/dark-PDF view and the dark Settings panel were visually inspected. Full browser regression: 33 passing tests; frontend: 29 passing tests. Native packaging and the Applications update succeeded. These checks do not close the native performance acceptance gate.
