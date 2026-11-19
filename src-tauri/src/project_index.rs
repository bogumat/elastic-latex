use crate::projects::{Project, Result};
use serde::Serialize;
use std::{collections::HashMap, fs};

pub fn files(project: &Project) -> Result<Vec<String>> {
    let mut folders = vec![(project.root.clone(), 0)];
    let mut files = Vec::new();
    let mut count = 0;
    while let Some((folder, depth)) = folders.pop() {
        count += 1;
        if count > 4096 || depth > 64 {
            return Err(
                "Project has too many folders to index (4,096 folders or 64 levels).".into(),
            );
        }
        for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') || matches!(name.as_str(), "node_modules" | "target" | "dist")
            {
                continue;
            }
            let kind = entry.file_type().map_err(|error| error.to_string())?;
            if kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            if kind.is_dir() {
                folders.push((path, depth + 1));
            } else if kind.is_file()
                && matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some(
                        "tex"
                            | "bib"
                            | "sty"
                            | "cls"
                            | "txt"
                            | "md"
                            | "csv"
                            | "json"
                            | "yaml"
                            | "yml"
                    )
                )
            {
                files.push(
                    path.strip_prefix(&project.root)
                        .unwrap()
                        .to_string_lossy()
                        .into_owned(),
                );
                if files.len() > 10_000 {
                    return Err("Project has more than 10,000 searchable text files.".into());
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

#[derive(Serialize)]
pub struct Hit {
    pub path: String,
    pub line: usize,
    pub text: String,
}
#[derive(Serialize)]
pub struct SearchResults {
    pub hits: Vec<Hit>,
    pub limited: bool,
    pub skipped: usize,
}
pub fn search(
    project: &Project,
    query: &str,
    case_sensitive: bool,
    overlays: HashMap<String, String>,
) -> Result<SearchResults> {
    if query.is_empty() || query.len() > 4096 || query.contains(['\n', '\r']) {
        return Err("Enter a single-line search of up to 4,096 bytes.".into());
    }
    if overlays.len() > 500 || overlays.values().map(String::len).sum::<usize>() > 32 * 1024 * 1024
    {
        return Err("Open buffers exceed the 32 MiB project-search limit.".into());
    }
    let query = if case_sensitive {
        query.to_string()
    } else {
        query.to_lowercase()
    };
    let mut result = SearchResults {
        hits: Vec::new(),
        limited: false,
        skipped: 0,
    };
    let mut bytes = 0;
    for path in files(project)? {
        let text = if let Some(text) = overlays.get(&path) {
            text.clone()
        } else {
            match crate::projects::read(project, &path) {
                Ok(file) => file.text,
                Err(_) => {
                    result.skipped += 1;
                    continue;
                }
            }
        };
        bytes += text.len();
        if bytes > 64 * 1024 * 1024 {
            result.limited = true;
            break;
        }
        for (index, line) in text.lines().enumerate() {
            let found = if case_sensitive {
                line.contains(&query)
            } else {
                line.to_lowercase().contains(&query)
            };
            if found {
                if result.hits.len() == 500 {
                    result.limited = true;
                    return Ok(result);
                }
                result.hits.push(Hit {
                    path: path.clone(),
                    line: index + 1,
                    text: line.chars().take(300).collect(),
                });
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn search_reads_dirty_buffers_and_respects_case() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("main.tex"), "disk text").unwrap();
        let project = Project::open(folder.path()).unwrap();
        let overlays = HashMap::from([("main.tex".into(), "unsaved\nNEEDLE".into())]);
        let result = search(&project, "needle", false, overlays.clone()).unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 2);
        assert!(search(&project, "needle", true, overlays)
            .unwrap()
            .hits
            .is_empty());
    }
    #[test]
    fn indexes_nested_text_and_skips_generated_and_hidden_files() {
        let folder = tempfile::tempdir().unwrap();
        for name in ["chapters", ".git", "node_modules", "dist"] {
            fs::create_dir(folder.path().join(name)).unwrap();
        }
        for name in [
            "main.tex",
            "chapters/intro.tex",
            ".git/private.txt",
            "dist/build.txt",
            "image.png",
            "main.aux",
        ] {
            fs::write(folder.path().join(name), "text").unwrap();
        }
        let project = Project::open(folder.path()).unwrap();
        assert_eq!(files(&project).unwrap(), ["chapters/intro.tex", "main.tex"]);
    }
}
