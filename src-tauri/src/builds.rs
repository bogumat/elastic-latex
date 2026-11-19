use crate::projects::{digest, Project, Result};
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    sync::mpsc,
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    pub available: bool,
    pub latexmk: Option<String>,
    pub message: String,
}

pub async fn discover() -> Toolchain {
    let mut paths = vec![
        PathBuf::from("/Library/TeX/texbin"),
        PathBuf::from("/usr/local/texlive/bin/universal-darwin"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&path));
    }
    for path in paths {
        let latexmk = path.join("latexmk");
        if !latexmk.is_file() || !path.join("pdflatex").is_file() {
            continue;
        }
        let version = tokio::time::timeout(
            Duration::from_secs(3),
            Command::new(&latexmk).arg("-v").kill_on_drop(true).output(),
        )
        .await;
        if matches!(version, Ok(Ok(ref output)) if output.status.success()) {
            return Toolchain {
                available: true,
                latexmk: Some(latexmk.to_string_lossy().into_owned()),
                message: "Local pdfLaTeX · latexmk".into(),
            };
        }
    }
    Toolchain { available: false, latexmk: None, message: "Install a local TeX distribution with latexmk and pdfLaTeX, then restart Elastic. Editing is available.".into() }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub path: String,
    pub line: usize,
    pub message: String,
}

pub fn diagnostics(log: &str, project: &Project) -> Vec<Diagnostic> {
    log.lines()
        .filter_map(|line| {
            // TeX's -file-line-error form. Leave ambiguous diagnostics in the raw log.
            let mut fields = line.splitn(3, ':');
            let path = fields.next()?.trim();
            let number = fields.next()?.parse::<usize>().ok()?;
            let message = fields.next()?.trim().to_string();
            let path = Path::new(path);
            let relative = if path.is_absolute() {
                path.strip_prefix(&project.root).ok()?
            } else {
                path
            };
            let relative = relative.to_string_lossy();
            let relative = relative.strip_prefix("./").unwrap_or(&relative).to_string();
            project.resolve(&relative).ok()?;
            Some(Diagnostic {
                path: relative,
                line: number.max(1),
                message,
            })
        })
        .take(100)
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildResult {
    pub project_id: String,
    pub build_id: String,
    pub status: String,
    pub diagnostics: Vec<Diagnostic>,
    pub log: String,
    pub elapsed_ms: u128,
}

pub struct BuildOutput {
    pub result: BuildResult,
    pub artifact: Option<PathBuf>,
}

async fn pump(reader: impl AsyncRead + Unpin, sender: mpsc::Sender<Vec<u8>>) {
    let mut reader = reader;
    let mut buffer = [0; 8192];
    loop {
        match reader.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(size) => {
                if sender.send(buffer[..size].to_vec()).await.is_err() {
                    break;
                }
            }
        }
    }
}

pub fn append_tail(tail: &mut String, text: &str, limit: usize) {
    tail.push_str(text);
    if tail.len() > limit {
        let mut boundary = tail.len() - limit;
        while !tail.is_char_boundary(boundary) {
            boundary += 1;
        }
        tail.drain(..boundary);
    }
}

#[cfg(unix)]
fn kill_tree(pid: u32) {
    // The child starts a new process group; target that group, never the app's.
    unsafe {
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
}

pub async fn run(
    project: &Project,
    root: &str,
    latexmk: &str,
    cache: &Path,
    build_id: &str,
    cancelled: Arc<AtomicBool>,
    progress: impl Fn(String),
) -> Result<BuildOutput> {
    let root_path = project.resolve(root)?;
    if root_path.extension().and_then(|s| s.to_str()) != Some("tex") {
        return Err("Select a .tex root document.".into());
    }
    let started = std::time::Instant::now();
    let tool_stamp = std::fs::metadata(latexmk).and_then(|m| m.modified()).ok();
    let key = digest(
        format!(
            "{}|{}|{}|{:?}|pdflatex-v1",
            project.id, root, latexmk, tool_stamp
        )
        .as_bytes(),
    );
    let work = cache.join(key);
    tokio::fs::create_dir_all(&work)
        .await
        .map_err(|e| e.to_string())?;
    // This file rotates every build; the incremental compiler directory is reused.
    let mut disk_log = tokio::fs::File::create(work.join("elastic-build.log"))
        .await
        .map_err(|e| e.to_string())?;
    let mut command = Command::new(latexmk);
    command
        .args([
            "-norc",
            "-pdf",
            "-interaction=nonstopmode",
            "-halt-on-error",
            "-file-line-error",
            "-no-shell-escape",
            "-synctex=1",
        ])
        .arg(format!("-outdir={}", work.display()))
        .arg(format!("./{root}"))
        .current_dir(&project.root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let tool_dir = Path::new(latexmk).parent().unwrap();
    command.env(
        "PATH",
        format!(
            "{}:{}",
            tool_dir.display(),
            std::env::var("PATH").unwrap_or_default()
        ),
    );
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command
        .spawn()
        .map_err(|e| format!("Could not start latexmk: {e}"))?;
    let pid = child.id().ok_or("Compiler has no process ID")?;
    let (sender, mut receiver) = mpsc::channel(32);
    let stdout = tokio::spawn(pump(child.stdout.take().unwrap(), sender.clone()));
    let stderr = tokio::spawn(pump(child.stderr.take().unwrap(), sender));
    let mut tail = String::new();
    let mut pending = String::new();
    let mut total_bytes = 0;
    let mut interval = tokio::time::interval(Duration::from_millis(100));
    let mut stopped = None;
    let mut io_failure = None;
    let mut exit = None;
    let mut stream_open = true;
    while exit.is_none() || stream_open {
        tokio::select! {
            chunk = receiver.recv(), if stream_open => {
                if let Some(chunk) = chunk {
                    total_bytes += chunk.len();
                    if total_bytes <= 32 * 1024 * 1024 {
                        if let Err(error) = disk_log.write_all(&chunk).await { io_failure = Some(error.to_string()); }
                    }
                    let text = String::from_utf8_lossy(&chunk);
                    append_tail(&mut tail, &text, 64 * 1024);
                    append_tail(&mut pending, &text, 8192);
                } else { stream_open = false; }
            }
            status = child.wait(), if exit.is_none() => { exit = Some(status.map_err(|e| e.to_string())?); }
            _ = interval.tick() => {
                if !pending.is_empty() { progress(std::mem::take(&mut pending)); }
                if stopped.is_none() && (cancelled.load(Ordering::Relaxed) || started.elapsed() > Duration::from_secs(120) || total_bytes > 32 * 1024 * 1024 || io_failure.is_some()) {
                    stopped = Some(if cancelled.load(Ordering::Relaxed) { "cancelled" } else { "failed" });
                    #[cfg(unix)]
                    kill_tree(pid);
                    let _ = child.start_kill();
                    let reason = if cancelled.load(Ordering::Relaxed) {
                        "Build cancelled.".to_string()
                    } else if let Some(error) = &io_failure {
                        format!("Build stopped: could not write the log: {error}")
                    } else if total_bytes > 32 * 1024 * 1024 {
                        "Build stopped: compiler output exceeded the 32 MiB log limit.".to_string()
                    } else {
                        "Build timed out after 120 seconds.".to_string()
                    };
                    append_tail(&mut tail, &format!("\n{reason}\n"), 64 * 1024);
                }
            }
        }
    }
    let _ = stdout.await;
    let _ = stderr.await;
    if !pending.is_empty() {
        progress(pending);
    }
    disk_log.flush().await.map_err(|e| e.to_string())?;
    let mut pdf_name = root_path.file_stem().unwrap().to_os_string();
    pdf_name.push(".pdf");
    let pdf = work.join(pdf_name);
    let status = stopped.unwrap_or(if exit.unwrap().success() {
        "succeeded"
    } else {
        "failed"
    });
    let mut artifact = None;
    let mut status = status.to_string();
    if status == "succeeded" {
        let valid = async {
            let mut file = tokio::fs::File::open(&pdf).await?;
            let mut header = [0; 5];
            file.read_exact(&mut header).await?;
            Ok::<bool, std::io::Error>(&header == b"%PDF-")
        }
        .await
        .unwrap_or(false);
        if valid {
            let published = cache.join(format!("preview-{build_id}.pdf"));
            tokio::fs::copy(&pdf, &published)
                .await
                .map_err(|e| e.to_string())?;
            artifact = Some(published);
        } else {
            status = "failed".into();
            tail.push_str("\nNo valid PDF was produced.\n");
        }
    }
    Ok(BuildOutput {
        result: BuildResult {
            project_id: project.id.clone(),
            build_id: build_id.into(),
            status,
            diagnostics: diagnostics(&tail, project),
            log: tail,
            elapsed_ms: started.elapsed().as_millis(),
        },
        artifact,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_tail_is_bounded() {
        let mut tail = String::new();
        append_tail(&mut tail, &"é".repeat(100), 11);
        assert!(tail.len() <= 11);
    }
    #[test]
    fn parses_only_contained_diagnostics() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("paper name.tex"), "").unwrap();
        let project = Project::open(dir.path()).unwrap();
        let errors = diagnostics("./paper name.tex:12: Undefined control sequence.\n../elsewhere.tex:2: error\n! unstructured", &project);
        assert_eq!(errors.len(), 1);
        assert_eq!(errors[0].line, 12);
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn cancellation_terminates_the_compiler_group() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("main.tex"), "test").unwrap();
        let fake = dir.path().join("fake-latexmk");
        std::fs::write(&fake, "#!/bin/sh\nsleep 60 &\necho $! > child.pid\nwait\n").unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
        let project = Project::open(dir.path()).unwrap();
        let cancelled = Arc::new(AtomicBool::new(false));
        let signal = cancelled.clone();
        let child_file = dir.path().join("child.pid");
        let signal_task = tokio::spawn(async move {
            for _ in 0..100 {
                if child_file.exists() {
                    signal.store(true, Ordering::Relaxed);
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("fake compiler did not start");
        });
        let output = tokio::time::timeout(
            Duration::from_secs(3),
            run(
                &project,
                "main.tex",
                fake.to_str().unwrap(),
                cache.path(),
                "cancel",
                cancelled,
                |_| {},
            ),
        )
        .await
        .unwrap()
        .unwrap();
        signal_task.await.unwrap();
        assert_eq!(output.result.status, "cancelled");
        assert!(output.artifact.is_none());
        let pid = std::fs::read_to_string(dir.path().join("child.pid"))
            .unwrap()
            .trim()
            .parse::<i32>()
            .unwrap();
        for _ in 0..100 {
            if unsafe { libc::kill(pid, 0) } == -1 {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("compiler child survived cancellation");
    }
    #[tokio::test]
    #[ignore = "requires a local TeX installation"]
    async fn real_compile_reuses_cache_and_preserves_published_pdf() {
        let toolchain = discover().await;
        let dir = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let source = dir.path().join("paper.v1 name.tex");
        std::fs::write(
            &source,
            "\\documentclass{article}\n\\begin{document}Hello Elastic\\end{document}",
        )
        .unwrap();
        let project = Project::open(dir.path()).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let first = run(
            &project,
            "paper.v1 name.tex",
            toolchain.latexmk.as_ref().unwrap(),
            cache.path(),
            "1",
            cancel.clone(),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(first.result.status, "succeeded", "{}", first.result.log);
        let second = run(
            &project,
            "paper.v1 name.tex",
            toolchain.latexmk.as_ref().unwrap(),
            cache.path(),
            "2",
            cancel.clone(),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(second.result.status, "succeeded");
        assert!(second.result.log.contains("Nothing to do"));
        std::fs::write(
            source,
            "\\documentclass{article}\n\\begin{document}\\brokencommand\\end{document}",
        )
        .unwrap();
        let failed = run(
            &project,
            "paper.v1 name.tex",
            toolchain.latexmk.as_ref().unwrap(),
            cache.path(),
            "3",
            cancel,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(failed.result.status, "failed");
        assert!(failed.artifact.is_none());
        assert!(first.artifact.unwrap().exists());
        assert!(!failed.result.diagnostics.is_empty());
    }
}
