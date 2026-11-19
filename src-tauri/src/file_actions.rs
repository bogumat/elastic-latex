use crate::projects::{Project, Result};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Move,
    Copy,
    Trash,
    Reveal,
    #[serde(rename = "copy-path")]
    CopyPath,
    #[serde(rename = "copy-relative-path")]
    CopyRelativePath,
}

fn validate(relative: &str) -> Result<()> {
    if relative
        .split('/')
        .any(|part| part.is_empty() || part.starts_with('.') || part.contains(['\\', '\0']))
    {
        return Err("Choose a visible file or folder inside the project.".into());
    }
    Ok(())
}

fn existing(project: &Project, relative: &str) -> Result<PathBuf> {
    validate(relative)?;
    let mut path = project.root.clone();
    for part in relative.split('/') {
        path.push(part);
        if fs::symlink_metadata(&path)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("File operations on symbolic links are not supported.".into());
        }
    }
    project.resolve(relative)
}

fn destination(project: &Project, relative: &str) -> Result<PathBuf> {
    validate(relative)?;
    let path = Path::new(relative);
    let parent = path.parent().unwrap();
    let parent = if parent.as_os_str().is_empty() {
        project.root.clone()
    } else {
        existing(project, &parent.to_string_lossy())?
    };
    if !parent.is_dir() {
        return Err("The destination must be a folder.".into());
    }
    Ok(parent.join(path.file_name().unwrap()))
}

// Exclusive rename prevents an external writer's newly created destination from
// being overwritten between validation and publication.
#[cfg(target_os = "macos")]
fn rename_exclusive(source: &Path, target: &Path) -> Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let source = CString::new(source.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    let target = CString::new(target.as_os_str().as_bytes()).map_err(|error| error.to_string())?;
    if unsafe { libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) } == 0 {
        return Ok(());
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        Err("A file or folder already exists at the destination.".into())
    } else {
        Err(error.to_string())
    }
}
#[cfg(not(target_os = "macos"))]
fn rename_exclusive(_: &Path, _: &Path) -> Result<()> {
    Err("File moves currently require macOS.".into())
}

fn copy_tree(source: &Path, target: &Path, items: &mut u64, bytes: &mut u64) -> Result<()> {
    *items += 1;
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("Copying symbolic links or special files is not supported.".into());
    }
    *bytes += if metadata.is_file() {
        metadata.len()
    } else {
        0
    };
    if *items > 10_000 || *bytes > 1024 * 1024 * 1024 {
        return Err("Copy is too large. Use Finder for more than 10,000 items or 1 GiB.".into());
    }
    if metadata.is_dir() {
        fs::create_dir(target).map_err(|error| error.to_string())?;
        for child in fs::read_dir(source).map_err(|error| error.to_string())? {
            let child = child.map_err(|error| error.to_string())?;
            copy_tree(&child.path(), &target.join(child.file_name()), items, bytes)?;
        }
    } else {
        fs::copy(source, target).map_err(|error| error.to_string())?;
    }
    fs::set_permissions(target, metadata.permissions()).map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn trash(path: &Path) -> Result<()> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|error| error.to_string())
}
#[cfg(not(target_os = "macos"))]
pub fn trash(_: &Path) -> Result<()> {
    Err("Move to Trash currently requires macOS.".into())
}

pub fn run(project: &Project, action: Action, path: &str, target: &str) -> Result<()> {
    if matches!(action, Action::Reveal) {
        let path = if path.is_empty() {
            project.root.clone()
        } else {
            existing(project, path)?
        };
        let status = std::process::Command::new("/usr/bin/open")
            .arg("-R")
            .arg(path)
            .status()
            .map_err(|error| error.to_string())?;
        return if status.success() {
            Ok(())
        } else {
            Err("Could not reveal the item in Finder.".into())
        };
    }
    let source = existing(project, path)?;
    if matches!(action, Action::CopyPath | Action::CopyRelativePath) {
        use std::{
            io::Write,
            process::{Command, Stdio},
        };
        let text = if matches!(action, Action::CopyPath) {
            source.to_string_lossy().into_owned()
        } else {
            path.to_string()
        };
        let mut child = Command::new("/usr/bin/pbcopy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|error| error.to_string())?;
        child
            .stdin
            .take()
            .unwrap()
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        return if child.wait().map_err(|error| error.to_string())?.success() {
            Ok(())
        } else {
            Err("Could not copy the path to the clipboard.".into())
        };
    }
    if matches!(action, Action::Trash) {
        return trash(&source);
    }
    let target = destination(project, target)?;
    if target == source || target.starts_with(&source) {
        return Err("Choose a different destination outside the source folder.".into());
    }
    match action {
        Action::Move => rename_exclusive(&source, &target),
        Action::Copy => {
            let temporary = tempfile::tempdir_in(target.parent().unwrap())
                .map_err(|error| error.to_string())?;
            let staged = temporary.path().join("copy");
            copy_tree(&source, &staged, &mut 0, &mut 0)?;
            rename_exclusive(&staged, &target)
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn moves_and_copies_nested_items_without_overwriting() {
        let folder = tempfile::tempdir().unwrap();
        let project = Project::open(folder.path()).unwrap();
        fs::create_dir(folder.path().join("chapters")).unwrap();
        fs::write(
            folder.path().join("chapters/intro.tex"),
            "Retain this content",
        )
        .unwrap();
        run(&project, Action::Copy, "chapters", "duplicate").unwrap();
        run(&project, Action::Move, "chapters", "renamed").unwrap();
        assert_eq!(
            fs::read_to_string(folder.path().join("duplicate/intro.tex")).unwrap(),
            "Retain this content"
        );
        assert!(run(
            &project,
            Action::Move,
            "renamed/intro.tex",
            "duplicate/intro.tex"
        )
        .is_err());
        assert!(run(&project, Action::Copy, "duplicate", "duplicate/child").is_err());
        for path in ["", "../outside", "/outside", ".git", "renamed/../bad"] {
            assert!(run(&project, Action::Move, "renamed", path).is_err());
            assert!(run(&project, Action::Trash, path, "").is_err());
        }
        assert!(folder.path().join("renamed/intro.tex").exists());
        run(
            &project,
            Action::Move,
            "renamed/intro.tex",
            "renamed/Intro.tex",
        )
        .unwrap();
        assert!(folder.path().join("renamed/Intro.tex").exists());
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "moves a disposable fixture to macOS Trash and restores it"]
    fn native_trash_is_recoverable() {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("elastic-trash-fixture.txt");
        fs::write(&original, "Recoverable fixture").unwrap();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&original.to_string_lossy()));
        let mut trashed = None;
        NSFileManager::defaultManager()
            .trashItemAtURL_resultingItemURL_error(&url, Some(&mut trashed))
            .unwrap();
        let trashed = PathBuf::from(trashed.unwrap().path().unwrap().to_string());
        assert!(!original.exists());
        assert_eq!(fs::read_to_string(&trashed).unwrap(), "Recoverable fixture");
        fs::rename(trashed, &original).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_and_cleans_up_failed_copies() {
        let folder = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let project = Project::open(folder.path()).unwrap();
        fs::create_dir(folder.path().join("source")).unwrap();
        std::os::unix::fs::symlink(outside.path(), folder.path().join("source/link")).unwrap();
        assert!(run(&project, Action::Copy, "source", "copy").is_err());
        assert!(!folder.path().join("copy").exists());
        assert!(run(&project, Action::Trash, "source/link", "").is_err());
        assert_eq!(fs::read_dir(folder.path()).unwrap().count(), 1);
    }
}
