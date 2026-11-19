use super::*;
use std::path::Path;

async fn git(runner: &Runner, path: &Path, args: &[&str]) -> String {
    runner.git(path, args).await.unwrap().checked().unwrap()
}
async fn identity(runner: &Runner, path: &Path) {
    for (key, value) in [
        ("user.name", "Test User"),
        ("user.email", "test@example.invalid"),
        ("commit.gpgsign", "false"),
        ("core.hooksPath", "/dev/null"),
    ] {
        git(runner, path, &["config", "--local", key, value]).await;
    }
}
#[test]
fn github_urls_and_destinations_are_restricted() {
    assert_eq!(
        github::slug("https://github.com/owner/paper.git/").unwrap(),
        "owner/paper"
    );
    assert_eq!(
        github::slug("git@github.com:owner/paper.git").unwrap(),
        "owner/paper"
    );
    for input in [
        "--upload-pack=bad",
        "https://github.com.evil/owner/repo",
        "https://token@github.com/a/b",
        "https://github.com/a/b/tree/main",
        "https://github.com/a/..",
        "file:///tmp/repo",
        "https://github.com/a/b?q=x",
    ] {
        assert!(github::slug(input).is_err(), "{input}");
    }
    let directory = tempfile::tempdir().unwrap();
    for name in ["../escape", ".", "", "a/b", "a\\b", "name\n"] {
        assert!(github::destination(directory.path(), name).is_err());
    }
    std::fs::create_dir(directory.path().join("existing")).unwrap();
    assert!(github::destination(directory.path(), "existing").is_err());
}
#[test]
fn status_parser_preserves_spaces_unicode_newlines_and_renames() {
    let changes =
        parse_changes("R  new name.tex\0old.tex\0?? études\nnotes.tex\0 M file.tex\0").unwrap();
    assert_eq!(changes.len(), 3);
    assert_eq!(changes[0].original_path.as_deref(), Some("old.tex"));
    assert_eq!(changes[1].path, "études\nnotes.tex");
    assert_eq!(changes[2].worktree, 'M');
    assert!(parse_changes("R  destination\0").is_err());
}
#[tokio::test]
async fn local_commit_push_pull_and_divergence_preserve_work() {
    let directory = tempfile::tempdir().unwrap();
    let base = directory.path();
    let runner = Runner::default();
    git(
        &runner,
        base,
        &["init", "--bare", "--initial-branch=main", "remote.git"],
    )
    .await;
    git(&runner, base, &["clone", "remote.git", "first"]).await;
    let first = Project::open(&base.join("first")).unwrap();
    identity(&runner, &first.root).await;
    std::fs::write(first.root.join("main.tex"), "first").unwrap();
    action(&runner, &first, Action::Commit, "", "Initial paper")
        .await
        .unwrap();
    action(&runner, &first, Action::Push, "origin", "")
        .await
        .unwrap();
    let current = status(&runner, &first).await.unwrap();
    assert_eq!(current.branch.as_deref(), Some("main"));
    assert!(current.changes.is_empty());
    git(&runner, base, &["clone", "remote.git", "second"]).await;
    let second = Project::open(&base.join("second")).unwrap();
    identity(&runner, &second.root).await;
    std::fs::write(second.root.join("main.tex"), "remote update").unwrap();
    action(&runner, &second, Action::Commit, "", "Update paper")
        .await
        .unwrap();
    action(&runner, &second, Action::Push, "origin", "")
        .await
        .unwrap();
    std::fs::write(first.root.join("local.tex"), "keep this").unwrap();
    assert!(action(&runner, &first, Action::Pull, "origin", "")
        .await
        .unwrap_err()
        .contains("Commit your changes"));
    std::fs::remove_file(first.root.join("local.tex")).unwrap();
    action(&runner, &first, Action::Pull, "origin", "")
        .await
        .unwrap();
    assert_eq!(
        std::fs::read_to_string(first.root.join("main.tex")).unwrap(),
        "remote update"
    );
    std::fs::write(first.root.join("local.tex"), "local commit").unwrap();
    action(&runner, &first, Action::Commit, "", "Local change")
        .await
        .unwrap();
    std::fs::write(second.root.join("other.tex"), "other commit").unwrap();
    action(&runner, &second, Action::Commit, "", "Remote change")
        .await
        .unwrap();
    action(&runner, &second, Action::Push, "origin", "")
        .await
        .unwrap();
    assert!(action(&runner, &first, Action::Pull, "origin", "")
        .await
        .is_err());
    assert!(action(&runner, &first, Action::Push, "origin", "")
        .await
        .is_err());
    assert_eq!(
        std::fs::read_to_string(first.root.join("local.tex")).unwrap(),
        "local commit"
    );
    let nested = first.root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    assert!(status(&runner, &Project::open(&nested).unwrap())
        .await
        .is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn fork_connects_a_separate_remote_without_rewriting_origin() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let fake = path.join("gh-test");
    std::fs::write(&fake, "#!/bin/sh\ncase \"$*\" in\n  *'--method POST'*) printf 'test-user/paper\\n';;\n  *'user --jq .login'*) printf 'test-user\\n';;\n  *) exit 1;;\nesac\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runner = Runner {
        github_cli: Some(fake),
        ..Default::default()
    };
    git(&runner, path, &["init", "-b", "main"]).await;
    git(
        &runner,
        path,
        &[
            "remote",
            "add",
            "origin",
            "https://github.com/original/paper.git",
        ],
    )
    .await;
    let project = Project::open(path).unwrap();
    action(&runner, &project, Action::Fork, "origin", "")
        .await
        .unwrap();
    assert_eq!(
        git(&runner, path, &["remote", "get-url", "origin"])
            .await
            .trim(),
        "https://github.com/original/paper.git"
    );
    assert_eq!(
        git(&runner, path, &["remote", "get-url", "fork"])
            .await
            .trim(),
        "https://github.com/test-user/paper.git"
    );
    assert!(action(&runner, &project, Action::Fork, "origin", "")
        .await
        .unwrap()
        .contains("already connected"));
}

#[cfg(unix)]
#[tokio::test]
async fn clone_service_uses_a_new_working_folder_and_preserves_existing_files() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let base = directory.path();
    let runner = Runner::default();
    git(&runner, base, &["init", "-b", "main", "seed"]).await;
    let seed = base.join("seed");
    identity(&runner, &seed).await;
    std::fs::write(seed.join("main.tex"), "cloned content").unwrap();
    action(
        &runner,
        &Project::open(&seed).unwrap(),
        Action::Commit,
        "",
        "Test fixture",
    )
    .await
    .unwrap();
    // Rewrite this one test GitHub URL to a local repository. Exercise real Git
    // cloning without network access, credentials, or changing global configuration.
    let wrapper = base.join("git-test");
    let setting = format!(
        "url.{}.insteadOf=https://github.com/example/paper.git",
        seed.display()
    )
    .replace('\'', "'\\''");
    std::fs::write(
        &wrapper,
        format!("#!/bin/sh\nexec /usr/bin/git -c '{setting}' \"$@\"\n"),
    )
    .unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runner = Runner {
        git_cli: Some(wrapper),
        ..Default::default()
    };
    let result = github::clone(
        &runner,
        "https://github.com/example/paper",
        base,
        "my paper",
        false,
    )
    .await
    .unwrap();
    assert_eq!(
        std::fs::read_to_string(Path::new(&result).join("main.tex")).unwrap(),
        "cloned content"
    );
    assert!(github::clone(
        &runner,
        "https://github.com/example/paper",
        base,
        "my paper",
        false
    )
    .await
    .unwrap_err()
    .contains("already exists"));
    assert_eq!(
        std::fs::read_to_string(Path::new(&result).join("main.tex")).unwrap(),
        "cloned content"
    );
    runner
        .cancelled
        .store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(github::clone(
        &runner,
        "https://github.com/example/paper",
        base,
        "cancelled clone",
        false
    )
    .await
    .unwrap_err()
    .contains("destination has been kept"));
    assert!(base.join("cancelled clone").is_dir());
}

#[cfg(unix)]
#[tokio::test]
async fn cancelling_git_terminates_descendants() {
    use std::{os::unix::fs::PermissionsExt, sync::atomic::Ordering, time::Duration};
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path();
    let fake = path.join("slow-git");
    std::fs::write(&fake, "#!/bin/sh\nsleep 60 &\necho $! > child.pid\nwait\n").unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
    let runner = Runner::default();
    let cancel = runner.cancelled.clone();
    let child_file = path.join("child.pid");
    let signal = tokio::spawn(async move {
        for _ in 0..100 {
            if child_file.exists() {
                cancel.store(true, Ordering::Relaxed);
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    });
    assert!(
        tokio::time::timeout(Duration::from_secs(3), runner.run(&fake, path, &[]))
            .await
            .unwrap()
            .unwrap_err()
            .contains("cancelled")
    );
    signal.await.unwrap();
    let pid = std::fs::read_to_string(path.join("child.pid"))
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
    panic!("Git descendant survived cancellation");
}
