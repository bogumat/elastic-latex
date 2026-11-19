use crate::{
    git::{self, process::Runner},
    projects::Result,
    AppState,
};
use std::{path::PathBuf, sync::atomic::Ordering};
use tauri::State;

#[tauri::command]
pub async fn git_status(project_id: String, state: State<'_, AppState>) -> Result<git::Status> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Another project operation is running. Try Refresh when it finishes.")?;
    git::status(&Runner::default(), &state.project(&project_id)?).await
}

#[tauri::command]
pub async fn git_action(
    project_id: String,
    action: git::Action,
    remote: String,
    message: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Another project operation is running.")?;
    state.idle()?;
    let project = state.project(&project_id)?;
    let runner = Runner::default();
    *state.git_cancel.lock().unwrap() = Some(runner.cancelled.clone());
    let result = git::action(&runner, &project, action, &remote, &message).await;
    *state.git_cancel.lock().unwrap() = None;
    result
}

#[tauri::command]
pub async fn clone_repository(
    url: String,
    parent: String,
    name: String,
    fork: bool,
    state: State<'_, AppState>,
) -> Result<String> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Another project operation is running.")?;
    state.idle()?;
    let runner = Runner::default();
    *state.git_cancel.lock().unwrap() = Some(runner.cancelled.clone());
    let result = git::github::clone(&runner, &url, &PathBuf::from(parent), &name, fork).await;
    *state.git_cancel.lock().unwrap() = None;
    result
}

#[tauri::command]
pub async fn cancel_git(state: State<'_, AppState>) -> Result<()> {
    if let Some(cancel) = state.git_cancel.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn github_account() -> Result<String> {
    git::github::account(&Runner::default(), &std::env::temp_dir()).await
}

#[tauri::command]
pub async fn git_diff(
    project_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let _operation = state
        .operation
        .try_lock()
        .map_err(|_| "Another project operation is running.")?;
    let project = state.project(&project_id)?;
    let runner = Runner::default();
    let status = git::status(&runner, &project).await?;
    let change = status
        .changes
        .iter()
        .find(|change| change.path == path)
        .ok_or("This file is no longer changed. Refresh repository status.")?;
    if status
        .changes
        .iter()
        .any(|item| item.path == path && item.index == '?')
    {
        return crate::blocking(move || {
            crate::projects::read(&project, &path).map(|data| {
                let mut preview: String = data.text.chars().take(128 * 1024).collect();
                if preview.len() < data.text.len() {
                    preview.push_str(
                        "\n[Preview truncated. Open the file to review the remaining content.]",
                    );
                }
                preview
            })
        })
        .await;
    }
    let head = runner
        .git(&project.root, &["rev-parse", "--verify", "HEAD"])
        .await?
        .success;
    let mut args = vec!["diff", "--no-ext-diff", "--no-textconv"];
    if head {
        args.push("HEAD");
    } else {
        args.push("--cached");
    }
    args.extend(["--", &path]);
    if let Some(original) = &change.original_path {
        args.push(original);
    }
    let mut result = runner.git(&project.root, &args).await?.checked()?;
    if !head {
        let unstaged = runner
            .git(
                &project.root,
                &["diff", "--no-ext-diff", "--no-textconv", "--", &path],
            )
            .await?
            .checked()?;
        if !unstaged.is_empty() {
            result.push_str("\nUnstaged changes:\n");
            result.push_str(&unstaged);
        }
    }
    if result.len() > 256 * 1024 {
        return Err("Diff exceeds 256 KiB. Review this file in a Git client or terminal.".into());
    }
    Ok(result)
}
