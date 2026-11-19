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
