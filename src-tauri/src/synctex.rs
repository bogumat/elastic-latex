use crate::projects::{Project, Result};
use serde::Serialize;
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncReadExt, process::Command};

#[derive(Debug, Serialize)]
pub struct SourceLocation {
    pub path: String,
    pub line: usize,
}

fn parse(project: &Project, output: &str) -> Result<SourceLocation> {
    let mut input = None;
    for line in output.lines() {
        if let Some(path) = line.strip_prefix("Input:") {
            input = Some(path);
        }
        if let (Some(path), Some(number)) = (input, line.strip_prefix("Line:")) {
            let Ok(number) = number.parse::<usize>() else {
                continue;
            };
            if number == 0 {
                continue;
            }
            let resolved = if Path::new(path).is_absolute() {
                Path::new(path)
                    .canonicalize()
                    .map_err(|error| error.to_string())?
            } else {
                project.resolve(path)?
            };
            let relative = resolved
                .strip_prefix(&project.root)
                .map_err(|_| "SyncTeX source is outside this project.")?;
            if resolved
                .extension()
                .and_then(|extension| extension.to_str())
                != Some("tex")
            {
                return Err("No editable LaTeX source at this position.".into());
            }
            return Ok(SourceLocation {
                path: relative.to_string_lossy().into_owned(),
                line: number,
            });
        }
    }
    Err("No source location found here. Try double-clicking nearby text or the centre of the image.".into())
}

pub async fn locate(
    project: &Project,
    pdf: &Path,
    executable: &Path,
    page: u32,
    x: f64,
    y: f64,
) -> Result<SourceLocation> {
    if page == 0 || !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 {
        return Err("Invalid PDF position.".into());
    }
    if !pdf.with_extension("synctex.gz").is_file() {
        return Err(
            "This build has no SyncTeX data. Compile again to enable PDF-to-source navigation."
                .into(),
        );
    }
    let mut child = Command::new(executable)
        .arg("edit")
        .arg("-o")
        .arg(format!("{page}:{x:.4}:{y:.4}:{}", pdf.display()))
        .env_remove("SYNCTEX_EDITOR")
        .current_dir(&project.root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("Could not run SyncTeX: {error}"))?;
    let stdout = child.stdout.take().unwrap();
    let output = tokio::time::timeout(Duration::from_secs(5), async {
        let mut bytes = Vec::new();
        stdout
            .take(64 * 1024 + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|error| error.to_string())?;
        if bytes.len() > 64 * 1024 {
            return Err("SyncTeX output exceeded its limit.".into());
        }
        let status = child.wait().await.map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("SyncTeX could not find a source location here.".into());
        }
        Ok::<String, String>(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
    .map_err(|_| "SyncTeX lookup timed out.")??;
    parse(project, &output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_contained_source_paths_with_spaces_and_rejects_external_files() {
        let folder = tempfile::tempdir().unwrap();
        std::fs::write(folder.path().join("my chapter.tex"), "hello").unwrap();
        let project = Project::open(folder.path()).unwrap();
        let location = parse(
            &project,
            "SyncTeX result begin\nInput:./my chapter.tex\nLine:12\nColumn:-1",
        )
        .unwrap();
        assert_eq!(location.path, "my chapter.tex");
        assert_eq!(location.line, 12);
        assert!(parse(&project, "Input:/etc/passwd\nLine:1").is_err());
        assert!(parse(&project, "Input:./my chapter.tex\nLine:0").is_err());
    }

    #[tokio::test]
    #[ignore = "requires a local TeX installation"]
    async fn maps_text_and_image_in_an_included_file_after_a_failed_build() {
        use crate::builds;
        use std::sync::{atomic::AtomicBool, Arc};
        let folder = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        std::fs::create_dir(folder.path().join("chapters")).unwrap();
        std::fs::write(folder.path().join("main.tex"), "\\documentclass{article}\n\\usepackage{graphicx}\n\\begin{document}\n\\input{chapters/my chapter}\n\\end{document}").unwrap();
        std::fs::write(folder.path().join("chapters/my chapter.tex"), "Mapped text in included source.\\par\n\\newpage\n\\includegraphics[width=2cm]{image.png}\n").unwrap();
        std::fs::write(
            folder.path().join("image.png"),
            include_bytes!("../icons/icon.png"),
        )
        .unwrap();
        let project = Project::open(folder.path()).unwrap();
        let tools = builds::discover().await;
        let latexmk = tools.latexmk.unwrap();
        let executable = Path::new(&latexmk).with_file_name("synctex");
        let built = builds::run(
            &project,
            "main.tex",
            &latexmk,
            cache.path(),
            "mapping",
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(built.result.status, "succeeded", "{}", built.result.log);
        let pdf = built.artifact.unwrap();
        for line in [1, 3] {
            let input = project.root.join("chapters/my chapter.tex");
            let query = Command::new(&executable)
                .arg("view")
                .arg("-i")
                .arg(format!("{line}:0:{}", input.display()))
                .arg("-o")
                .arg(&pdf)
                .env_remove("SYNCTEX_VIEWER")
                .current_dir(&project.root)
                .output()
                .await
                .unwrap();
            let output = String::from_utf8_lossy(&query.stdout);
            let value = |key: &str| {
                output
                    .lines()
                    .find_map(|entry| entry.strip_prefix(key))
                    .unwrap()
                    .trim()
                    .to_string()
            };
            let page = value("Page:").parse().unwrap();
            let x = value("x:").parse().unwrap();
            let y = value("y:").parse().unwrap();
            let location = locate(&project, &pdf, &executable, page, x, y)
                .await
                .unwrap();
            assert_eq!(location.path, "chapters/my chapter.tex");
            assert_eq!(location.line, line);
        }
        let original = std::fs::read(pdf.with_extension("synctex.gz")).unwrap();
        std::fs::write(
            folder.path().join("main.tex"),
            "\\documentclass{article}\\begin{document}\\undefinedcommand\\end{document}",
        )
        .unwrap();
        let failed = builds::run(
            &project,
            "main.tex",
            &latexmk,
            cache.path(),
            "failed-map",
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(failed.result.status, "failed");
        assert_eq!(
            std::fs::read(pdf.with_extension("synctex.gz")).unwrap(),
            original
        );
        assert!(locate(&project, &pdf, &executable, 1, f64::NAN, 0.0)
            .await
            .is_err());
    }
}
