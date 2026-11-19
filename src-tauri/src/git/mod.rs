pub mod github;
pub mod process;

use crate::projects::{Project, Result};
use process::Runner;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub original_path: Option<String>,
    pub index: char,
    pub worktree: char,
}
#[derive(Serialize)]
pub struct Remote {
    pub name: String,
    pub url: String,
    pub push_url: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub repository: bool,
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u64,
    pub behind: u64,
    pub changes: Vec<Change>,
    pub remotes: Vec<Remote>,
    pub conflicted: bool,
    pub merging: bool,
}

pub fn parse_changes(output: &str) -> Result<Vec<Change>> {
    let mut fields = output.split('\0').filter(|field| !field.is_empty());
    let mut changes = Vec::new();
    while let Some(field) = fields.next() {
        let bytes = field.as_bytes();
        if bytes.len() < 4 || bytes[2] != b' ' {
            return Err("Unexpected Git status format.".into());
        }
        let index = bytes[0] as char;
        let worktree = bytes[1] as char;
        let original_path = if matches!(index, 'R' | 'C') || matches!(worktree, 'R' | 'C') {
            Some(fields.next().ok_or("Missing Git rename source")?.into())
        } else {
            None
        };
        changes.push(Change {
            path: field[3..].into(),
            original_path,
            index,
            worktree,
        });
    }
    Ok(changes)
}

pub async fn require_root(runner: &Runner, project: &Project) -> Result<bool> {
    let output = runner
        .git(&project.root, &["rev-parse", "--show-toplevel"])
        .await?;
    if !output.success {
        if output.stderr.contains("not a git repository") {
            return Ok(false);
        }
        return Err(output.stderr);
    }
    let root = std::fs::canonicalize(output.stdout.strip_suffix('\n').unwrap_or(&output.stdout))
        .map_err(|e| e.to_string())?;
    if root != project.root {
        return Err(format!("Open the repository's working folder ({}) to use Git. The current folder is inside that repository.", root.display()));
    }
    Ok(true)
}

pub async fn status(runner: &Runner, project: &Project) -> Result<Status> {
    let mut status = Status {
        repository: false,
        branch: None,
        upstream: None,
        ahead: 0,
        behind: 0,
        changes: vec![],
        remotes: vec![],
        conflicted: false,
        merging: false,
    };
    if !require_root(runner, project).await? {
        return Ok(status);
    }
    status.repository = true;
    let branch = runner
        .git(
            &project.root,
            &["symbolic-ref", "--quiet", "--short", "HEAD"],
        )
        .await?;
    if branch.success {
        status.branch = Some(branch.stdout.trim_end().into());
    }
    status.changes = parse_changes(
        &runner
            .git(
                &project.root,
                &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
            )
            .await?
            .checked()?,
    )?;
    status.conflicted = status.changes.iter().any(|change| {
        change.index == 'U'
            || change.worktree == 'U'
            || (change.index == 'A' && change.worktree == 'A')
            || (change.index == 'D' && change.worktree == 'D')
    });
    let git_dir = runner
        .git(&project.root, &["rev-parse", "--absolute-git-dir"])
        .await?
        .checked()?;
    status.merging = [
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "rebase-merge",
        "rebase-apply",
        "sequencer",
    ]
    .iter()
    .any(|name| std::path::Path::new(git_dir.trim_end()).join(name).exists());
    let upstream = runner
        .git(
            &project.root,
            &[
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{upstream}",
            ],
        )
        .await?;
    if upstream.success {
        status.upstream = Some(upstream.stdout.trim_end().into());
        let counts = runner
            .git(
                &project.root,
                &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
            )
            .await?
            .checked()?;
        let mut counts = counts.split_whitespace();
        status.ahead = counts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
        status.behind = counts.next().and_then(|n| n.parse().ok()).unwrap_or(0);
    }
    let remotes = runner.git(&project.root, &["remote"]).await?.checked()?;
    for name in remotes.lines() {
        let url = runner
            .git(&project.root, &["remote", "get-url", "--", name])
            .await?
            .checked()?
            .trim_end()
            .into();
        let push_url = runner
            .git(
                &project.root,
                &["remote", "get-url", "--push", "--all", "--", name],
            )
            .await?
            .checked()?
            .trim_end()
            .into();
        status.remotes.push(Remote {
            name: name.into(),
            url,
            push_url,
        });
    }
    Ok(status)
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Init,
    Commit,
    Fetch,
    Pull,
    Push,
    Fork,
}

pub async fn action(
    runner: &Runner,
    project: &Project,
    action: Action,
    remote: &str,
    message: &str,
) -> Result<String> {
    let current = status(runner, project).await?;
    if matches!(action, Action::Init) {
        if current.repository {
            return Err("This folder is already a Git repository.".into());
        }
        return runner
            .git(&project.root, &["init", "-b", "main"])
            .await?
            .checked();
    }
    if !current.repository {
        return Err("This folder is not a Git repository.".into());
    }
    if current.conflicted || current.merging {
        return Err("Resolve the merge/rebase conflicts in a Git client or terminal, then refresh. Elastic will not rewrite or discard the conflicted files.".into());
    }
    if matches!(action, Action::Commit) {
        if message.trim().is_empty() {
            return Err("Enter a commit message.".into());
        }
        if message.len() > 10_000 {
            return Err("Keep the commit message below 10,000 bytes.".into());
        }
        if current.changes.is_empty() {
            return Err("No changes to commit.".into());
        }
        // Identity and hooks belong to the user. Do not add authors or trailers.
        runner
            .git(&project.root, &["add", "--all", "--", "."])
            .await?
            .checked()?;
        return runner
            .git(&project.root, &["commit", "-m", message])
            .await?
            .checked();
    }
    let selected = current
        .remotes
        .iter()
        .find(|candidate| candidate.name == remote)
        .ok_or("Select a remote.")?;
    if matches!(action, Action::Fork) {
        return github::fork_remote(runner, project, &selected.url, &current.remotes).await;
    }
    if matches!(action, Action::Fetch) {
        return runner
            .git(&project.root, &["fetch", "--", remote])
            .await?
            .checked();
    }
    let branch = current.branch.ok_or("Checkout a branch in a Git client or terminal before pulling or pushing (HEAD is detached).")?;
    if matches!(action, Action::Pull) {
        if !current.changes.is_empty() {
            return Err("Commit your changes or move untracked files before pulling. Elastic does not automatically stash or discard files.".into());
        }
        runner
            .git(
                &project.root,
                &["pull", "--ff-only", "--no-rebase", "--", remote, &branch],
            )
            .await?
            .checked()
    } else {
        let output = runner
            .git(
                &project.root,
                &[
                    "push",
                    "--set-upstream",
                    "--",
                    remote,
                    &format!("HEAD:refs/heads/{branch}"),
                ],
            )
            .await?;
        let detail = output.stderr.clone();
        let text = output.checked()?;
        Ok(format!("{text}\n{detail}").trim().into())
    }
}

#[cfg(test)]
mod tests;
