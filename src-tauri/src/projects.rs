use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, String>;
pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(skip)]
    pub root: PathBuf,
}

impl Project {
    pub fn open(path: &Path) -> Result<Self> {
        let root = path.canonicalize().map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Choose a project folder.".into());
        }
        let id = digest(root.to_string_lossy().as_bytes());
        let name = root
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        Ok(Self {
            id,
            name,
            path: root.to_string_lossy().into_owned(),
            root,
        })
    }
    pub fn resolve(&self, relative: &str) -> Result<PathBuf> {
        let path = Path::new(relative);
        if path.is_absolute()
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
        {
            return Err("Path must stay inside the project.".into());
        }
        let resolved = self
            .root
            .join(path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !resolved.starts_with(&self.root) {
            return Err("Symlink escapes the project.".into());
        }
        Ok(resolved)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub directory: bool,
}

pub fn list(project: &Project, directory: &str) -> Result<Vec<Entry>> {
    let directory = project.resolve(directory)?;
    let mut entries = Vec::new();
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target") {
            continue;
        }
        let path = entry.path();
        let Ok(canonical) = path.canonicalize() else {
            continue;
        };
        if !canonical.starts_with(&project.root) {
            continue;
        }
        entries.push(Entry {
            path: path
                .strip_prefix(&project.root)
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            name,
            directory: canonical.is_dir(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub text: String,
    pub version: String,
    pub line_ending: String,
}

// Resolve the existing parent, then create exclusively: never follow or replace
// an existing destination (including symlinks).
pub fn create(project: &Project, relative: &str, directory: bool) -> Result<()> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts
        .iter()
        .any(|part| part.is_empty() || part.starts_with('.') || part.contains(['\\', '\0']))
    {
        return Err("Use a relative path with visible file and folder names.".into());
    }
    let name = parts.last().ok_or("Enter a name.")?;
    let parent = project.resolve(&parts[..parts.len() - 1].join("/"))?;
    let destination = parent.join(name);
    let result = if directory {
        fs::create_dir(destination)
    } else {
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)
            .map(|_| ())
    };
    result.map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "A file or folder already exists at that path.".into()
        } else {
            error.to_string()
        }
    })
}

pub fn read(project: &Project, path: &str) -> Result<FileData> {
    let path = project.resolve(path)?;
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Source files larger than 16 MiB are not supported by this prototype.".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let version = digest(&bytes);
    let text = String::from_utf8(bytes)
        .map_err(|_| "This file is not UTF-8. Convert its encoding before editing.".to_string())?;
    if text.contains('\0') {
        return Err("This appears to be a binary file.".into());
    }
    let line_ending = if text.contains("\r\n") { "\r\n" } else { "\n" }.into();
    Ok(FileData {
        text,
        version,
        line_ending,
    })
}

// Called under the project's operation mutex. The external version is checked twice,
// with the final check immediately before replacement. External writers do not share
// this lock: a filesystem-wide compare-and-swap is not promised.
pub fn save(project: &Project, relative: &str, text: &str, expected: &str) -> Result<String> {
    let path = project.resolve(relative)?;
    let check = || -> Result<()> {
        if digest(&fs::read(&path).map_err(|e| e.to_string())?) != expected {
            return Err("File changed on disk. Your edits are retained; reopen after resolving the external change.".into());
        }
        Ok(())
    };
    check()?;
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
    temp.as_file()
        .set_permissions(
            fs::metadata(&path)
                .map_err(|e| e.to_string())?
                .permissions(),
        )
        .map_err(|e| e.to_string())?;
    temp.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    check()?;
    temp.persist(&path).map_err(|e| e.to_string())?;
    Ok(digest(text.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn creates_entries_without_overwriting_or_escaping() {
        let dir = tempfile::tempdir().unwrap();
        let project = Project::open(dir.path()).unwrap();
        create(&project, "chapters", true).unwrap();
        create(&project, "chapters/intro.tex", false).unwrap();
        fs::write(dir.path().join("chapters/intro.tex"), "Keep this").unwrap();
        assert!(create(&project, "chapters/intro.tex", false).is_err());
        assert!(create(&project, "chapters", true).is_err());
        assert_eq!(
            read(&project, "chapters/intro.tex").unwrap().text,
            "Keep this"
        );
        for path in [
            "",
            "../escape.tex",
            "/absolute.tex",
            "a/../b",
            ".git/config",
            "a//b",
            "a/",
            "missing/file.tex",
        ] {
            assert!(create(&project, path, false).is_err(), "{path}");
        }
        create(&project, "notes.md", false).unwrap();
        assert!(list(&project, "")
            .unwrap()
            .iter()
            .any(|entry| entry.path == "notes.md"));
    }
    #[test]
    fn containment_conflicts_and_line_endings() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("main.tex"), "first\r\n").unwrap();
        let project = Project::open(dir.path()).unwrap();
        assert!(project.resolve("../main.tex").is_err());
        assert!(project.resolve("/etc/passwd").is_err());
        let file = read(&project, "main.tex").unwrap();
        assert_eq!(file.line_ending, "\r\n");
        let next = save(&project, "main.tex", "second\r\n", &file.version).unwrap();
        assert_ne!(next, file.version);
        assert!(save(&project, "main.tex", "stale", &file.version).is_err());
        assert_eq!(
            fs::read_to_string(dir.path().join("main.tex")).unwrap(),
            "second\r\n"
        );
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        let dir = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/etc", dir.path().join("outside")).unwrap();
        assert!(Project::open(dir.path())
            .unwrap()
            .resolve("outside/passwd")
            .is_err());
        let project = Project::open(dir.path()).unwrap();
        assert!(create(&project, "outside/escape.tex", false).is_err());
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("untouched.tex");
        std::os::unix::fs::symlink(&target, dir.path().join("linked.tex")).unwrap();
        assert!(create(&project, "linked.tex", false).is_err());
        assert!(!target.exists());
    }
}
