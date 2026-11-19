use super::{process::Runner, Remote};
use crate::projects::{Project, Result};
use std::path::Path;

// Accept GitHub repository URLs, never arbitrary process options or Git transports.
pub fn slug(input: &str) -> Result<String> {
    let input = input.trim().trim_end_matches('/');
    let path = input
        .strip_prefix("https://github.com/")
        .or_else(|| input.strip_prefix("git@github.com:"))
        .or_else(|| input.strip_prefix("ssh://git@github.com/"))
        .ok_or("Paste a GitHub repository URL, such as https://github.com/owner/repository.")?;
    let path = path.strip_suffix(".git").unwrap_or(path);
    let parts: Vec<&str> = path.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || *part == "."
                || *part == ".."
                || part.starts_with('-')
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
        })
    {
        return Err("Use the repository's main GitHub URL (without credentials, a branch, query, or fragment).".into());
    }
    Ok(path.into())
}

pub fn destination(parent: &Path, name: &str) -> Result<std::path::PathBuf> {
    if name.is_empty()
        || name.trim() != name
        || name.starts_with('.')
        || name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
    {
        return Err(
            "Choose a new folder name without slashes, control characters, or a leading dot."
                .into(),
        );
    }
    let parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !parent.is_dir() {
        return Err("Choose a parent folder.".into());
    }
    let destination = parent.join(name);
    if destination.symlink_metadata().is_ok() {
        return Err(
            "That folder already exists. Choose a new name; existing files will not be replaced."
                .into(),
        );
    }
    Ok(destination)
}

pub async fn account(runner: &Runner, directory: &Path) -> Result<String> {
    runner.gh(directory, &["api", "--hostname", "github.com", "user", "--jq", ".login"]).await
        .map(|name| name.trim().into())
        .map_err(|error| format!("Could not verify your GitHub sign-in. Run gh auth login --hostname github.com, or check your connection, then retry.\n{error}"))
}

async fn create_fork(runner: &Runner, directory: &Path, original: &str) -> Result<String> {
    let response = runner
        .gh(
            directory,
            &[
                "api",
                "--hostname",
                "github.com",
                "--method",
                "POST",
                &format!("repos/{original}/forks"),
                "--jq",
                ".full_name",
            ],
        )
        .await.map_err(|error| format!("Fork request failed. If the connection was interrupted, GitHub may already have created your fork; check your account before retrying.\n{error}"))?;
    slug(&format!("https://github.com/{}", response.trim()))
}

pub async fn fork_remote(
    runner: &Runner,
    project: &Project,
    url: &str,
    remotes: &[Remote],
) -> Result<String> {
    let original = slug(url)?;
    let login = account(runner, &project.root).await?;
    if original.split('/').next() == Some(login.as_str()) {
        return Err("This repository already belongs to your GitHub account.".into());
    }
    let expected = format!("{login}/{}", original.split('/').nth(1).unwrap());
    if let Some(existing) = remotes.iter().find(|remote| remote.name == "fork") {
        if slug(&existing.url).ok().as_deref() == Some(&expected) {
            return Ok("Your fork is already connected. Select the fork remote to push.".into());
        }
        return Err("A different remote named fork already exists. Rename it in a Git client before adding another fork.".into());
    }
    let fork = create_fork(runner, &project.root, &original).await?;
    let url = format!("https://github.com/{fork}.git");
    runner
        .git(&project.root, &["remote", "add", "fork", &url])
        .await
        .and_then(|output| output.checked())
        .map_err(|error| format!("Fork created at {url}, but adding its remote failed: {error}"))?;
    Ok(format!("Fork connected: https://github.com/{fork}\nSelect the fork remote to push. Existing remotes are unchanged."))
}

pub async fn clone(
    runner: &Runner,
    url: &str,
    parent: &Path,
    name: &str,
    fork: bool,
) -> Result<String> {
    let original = slug(url)?;
    let target = destination(parent, name)?;
    let parent = target.parent().unwrap();
    // Reserve a new destination before any remote mutation. Failed clones are kept.
    std::fs::create_dir(&target).map_err(|e| format!("Could not create the destination: {e}"))?;
    let repository = if fork {
        create_fork(runner, parent, &original).await.map_err(|error| format!("Fork request did not complete. A fork may have been created; check GitHub before retrying. The reserved local folder is {}.\n{error}", target.display()))?
    } else {
        original.clone()
    };
    let clone_url = if !fork && !url.trim().starts_with("https://") {
        format!("git@github.com:{repository}.git")
    } else {
        format!("https://github.com/{repository}.git")
    };
    let mut attempts = 0;
    loop {
        let result = runner
            .git(
                parent,
                &[
                    "clone",
                    "--",
                    &clone_url,
                    target.to_str().ok_or("Folder path is not UTF-8")?,
                ],
            )
            .await
            .and_then(|output| output.checked());
        // GitHub creates forks asynchronously. Retry only a not-found response while
        // Git has left the reserved destination completely empty.
        if let Err(error) = &result {
            let empty = std::fs::read_dir(&target)
                .map(|mut entries| entries.next().is_none())
                .unwrap_or(false);
            if fork && attempts < 5 && empty && error.to_lowercase().contains("not found") {
                attempts += 1;
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                continue;
            }
        }
        result.map_err(|error| {
            format!(
                "Clone did not complete. The destination has been kept at {}.{}\n{error}",
                target.display(),
                if fork {
                    format!(" Your fork may already exist at https://github.com/{repository}.")
                } else {
                    String::new()
                }
            )
        })?;
        break;
    }
    if fork {
        runner
            .git(
                &target,
                &[
                    "remote",
                    "add",
                    "upstream",
                    &format!("https://github.com/{original}.git"),
                ],
            )
            .await.and_then(|output| output.checked())
            .map_err(|error| format!("Cloned into {}, but adding the upstream remote failed. You can open the cloned folder directly.\n{error}", target.display()))?;
    }
    Ok(target.to_string_lossy().into_owned())
}
