use crate::projects::Result;
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
    io::{AsyncRead, AsyncReadExt},
    process::Command,
};

pub fn executable(name: &str) -> Result<PathBuf> {
    let mut directories: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    directories.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
    directories
        .into_iter()
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .ok_or_else(|| {
            format!(
                "{name} is not installed. {}",
                if name == "gh" {
                    "Install GitHub CLI and run gh auth login once to connect your account."
                } else {
                    "Install Git (or Xcode Command Line Tools on macOS)."
                }
            )
        })
}

#[derive(Default, Clone)]
pub struct Runner {
    pub cancelled: Arc<AtomicBool>,
    pub github_cli: Option<PathBuf>,
    pub git_cli: Option<PathBuf>,
}

#[derive(Debug)]
pub struct Output {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}
impl Output {
    pub fn checked(self) -> Result<String> {
        if self.success {
            Ok(self.stdout)
        } else {
            Err(format!("{}\n{}", self.stderr.trim(), self.stdout.trim())
                .trim()
                .to_string())
        }
    }
}

async fn bounded(mut reader: impl AsyncRead + Unpin) -> std::io::Result<Vec<u8>> {
    let mut result = Vec::new();
    let mut buffer = [0; 8192];
    loop {
        let size = reader.read(&mut buffer).await?;
        if size == 0 {
            return Ok(result);
        }
        if result.len() + size > 4 * 1024 * 1024 {
            return Err(std::io::Error::other("Git output exceeded 4 MiB. Narrow the working folder or use a terminal for this operation."));
        }
        result.extend_from_slice(&buffer[..size]);
    }
}

// Killing a timed-out git parent is insufficient: SSH, helpers, and hooks can survive.
struct ProcessGroup(u32);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        if self.0 != 0 {
            unsafe {
                libc::kill(-(self.0 as i32), libc::SIGKILL);
            }
        }
    }
}

impl Runner {
    pub async fn run(&self, program: &Path, directory: &Path, args: &[&str]) -> Result<Output> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err("Git operation cancelled.".into());
        }
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(directory)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .env("GH_PROMPT_DISABLED", "1")
            .env("GH_HOST", "github.com")
            .env("GIT_SSH_COMMAND", "ssh -o BatchMode=yes")
            .env("GIT_PAGER", "cat")
            .env("GH_PAGER", "cat")
            .env("NO_COLOR", "1")
            .env("LC_ALL", "C")
            .env("GIT_OPTIONAL_LOCKS", "0");
        // Inherited Git routing variables must not redirect operations to a different repo.
        for variable in [
            "GIT_DIR",
            "GIT_WORK_TREE",
            "GIT_INDEX_FILE",
            "GIT_COMMON_DIR",
            "GIT_OBJECT_DIRECTORY",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        ] {
            command.env_remove(variable);
        }
        #[cfg(unix)]
        command.process_group(0);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start {}: {error}", program.display()))?;
        let mut group = ProcessGroup(child.id().ok_or("Git process has no ID")?);
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let cancelled = async {
            while !self.cancelled.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        };
        let result = tokio::select! {
            result = async { tokio::try_join!(child.wait(), bounded(stdout), bounded(stderr)) } => result.map_err(|e| e.to_string()),
            _ = cancelled => Err("Git operation cancelled. Check repository status before retrying.".into()),
            _ = tokio::time::sleep(Duration::from_secs(180)) => Err("Git operation timed out after 180 seconds. Check your connection and authentication, then refresh repository status.".into()),
        };
        match result {
            Ok((status, stdout, stderr)) => {
                group.0 = 0;
                Ok(Output {
                    success: status.success(),
                    stdout: String::from_utf8(stdout).map_err(|_| {
                        "Git returned non-UTF-8 paths; use a terminal for this repository."
                    })?,
                    stderr: String::from_utf8_lossy(&stderr).into_owned(),
                })
            }
            Err(error) => {
                drop(group);
                let _ = child.kill().await;
                Err(error)
            }
        }
    }
    pub async fn git(&self, directory: &Path, args: &[&str]) -> Result<Output> {
        let executable = self
            .git_cli
            .clone()
            .map(Ok)
            .unwrap_or_else(|| executable("git"))?;
        let mut options = vec![
            "-c".to_string(),
            "color.ui=false".into(),
            "--literal-pathspecs".into(),
        ];
        // Add gh as a fallback credential helper for GitHub without changing global config.
        if let Some(gh) = self
            .github_cli
            .clone()
            .or_else(|| super::process::executable("gh").ok())
        {
            let escaped = gh.to_string_lossy().replace('\'', "'\\''");
            options.extend([
                "-c".into(),
                format!("credential.https://github.com.helper=!'{escaped}' auth git-credential"),
            ]);
        }
        let mut borrowed: Vec<&str> = options.iter().map(String::as_str).collect();
        borrowed.extend_from_slice(args);
        self.run(&executable, directory, &borrowed).await
    }
    pub async fn gh(&self, directory: &Path, args: &[&str]) -> Result<String> {
        let executable = self
            .github_cli
            .clone()
            .map(Ok)
            .unwrap_or_else(|| executable("gh"))?;
        self.run(&executable, directory, args).await?.checked()
    }
}
