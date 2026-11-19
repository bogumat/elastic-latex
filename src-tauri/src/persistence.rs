use crate::projects::{Project, Result};
use serde::{Deserialize, Serialize};
use std::{io::Write, path::Path};

#[derive(Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub name: String,
    pub path: String,
}
#[derive(Serialize, Deserialize)]
struct History {
    version: u8,
    projects: Vec<RecentProject>,
}

pub fn recent(directory: &Path) -> Result<Vec<RecentProject>> {
    let path = directory.join("recent-projects.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let history: History = serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if history.version != 1 {
        return Err("Unsupported recent-projects version.".into());
    }
    Ok(history.projects.into_iter().take(8).collect())
}
pub fn remember(directory: &Path, project: &Project) -> Result<()> {
    let mut projects = recent(directory).unwrap_or_default();
    projects.retain(|item| item.path != project.path);
    projects.insert(
        0,
        RecentProject {
            name: project.name.clone(),
            path: project.path.clone(),
        },
    );
    projects.truncate(8);
    std::fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let bytes = serde_json::to_vec(&History {
        version: 1,
        projects,
    })
    .map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.persist(directory.join("recent-projects.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_is_bounded_and_reopening_moves_project_to_front() {
        let storage = tempfile::tempdir().unwrap();
        let folders = tempfile::tempdir().unwrap();
        for index in 0..10 {
            let path = folders.path().join(index.to_string());
            std::fs::create_dir(&path).unwrap();
            remember(storage.path(), &Project::open(&path).unwrap()).unwrap();
        }
        remember(
            storage.path(),
            &Project::open(&folders.path().join("4")).unwrap(),
        )
        .unwrap();
        let history = recent(storage.path()).unwrap();
        assert_eq!(history.len(), 8);
        assert_eq!(history[0].name, "4");
        assert_eq!(history.iter().filter(|item| item.name == "4").count(), 1);
    }
}
