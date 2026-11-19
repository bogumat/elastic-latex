mod builds;
mod commands;
mod file_actions;
mod git;
mod images;
mod persistence;
mod project_index;
mod projects;
mod synctex;

use projects::{Project, Result};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};

#[derive(Default)]
struct AppState {
    project: Mutex<Option<Project>>,
    operation: tokio::sync::Mutex<()>,
    running: Mutex<Option<Arc<AtomicBool>>>,
    artifact: Mutex<Option<(String, String, PathBuf)>>,
    toolchain: tokio::sync::OnceCell<builds::Toolchain>,
    sequence: AtomicU64,
    git_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

impl AppState {
    fn project(&self, id: &str) -> Result<Project> {
        self.project
            .lock()
            .unwrap()
            .as_ref()
            .filter(|p| p.id == id)
            .cloned()
            .ok_or("This project is no longer open.".into())
    }
    fn idle(&self) -> Result<()> {
        if self.running.lock().unwrap().is_some() {
            Err("Wait for the active build to finish or stop it.".into())
        } else {
            Ok(())
        }
    }
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_project(
    path: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Project> {
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = blocking(move || Project::open(&PathBuf::from(path))).await?;
    let history = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let remembered = project.clone();
    if let Err(error) = blocking(move || persistence::remember(&history, &remembered)).await {
        eprintln!("Could not remember the working folder: {error}");
    }
    *state.project.lock().unwrap() = Some(project.clone());
    let old = state.artifact.lock().unwrap().take();
    if let Some((_, _, path)) = old {
        let _ = tokio::fs::remove_file(path.with_extension("synctex.gz")).await;
        let _ = tokio::fs::remove_file(path).await;
    }
    Ok(project)
}

#[tauri::command]
async fn recent_projects(app: tauri::AppHandle) -> Result<Vec<persistence::RecentProject>> {
    let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
    blocking(move || persistence::recent(&directory)).await
}

// A single serialized disk refresh after a pull. Missing files become closed tabs;
// unsupported/failed reads reject the whole refresh so the frontend keeps buffers.
#[tauri::command]
async fn reload_files(
    project_id: String,
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Option<projects::FileData>>> {
    let _operation = state.operation.lock().await;
    let project = state.project(&project_id)?;
    blocking(move || {
        let mut files = std::collections::HashMap::new();
        for path in paths {
            // Validate containment even for paths removed by Git.
            let relative = std::path::Path::new(&path);
            if relative.is_absolute()
                || relative
                    .components()
                    .any(|part| !matches!(part, std::path::Component::Normal(_)))
            {
                return Err("Invalid source path.".into());
            }
            if !project
                .root
                .join(relative)
                .try_exists()
                .map_err(|e| e.to_string())?
            {
                files.insert(path, None);
            } else {
                let data = projects::read(&project, &path)?;
                files.insert(path, Some(data));
            }
        }
        Ok(files)
    })
    .await
}

#[tauri::command]
async fn search_project(
    project_id: String,
    query: String,
    case_sensitive: bool,
    overlays: std::collections::HashMap<String, String>,
    state: State<'_, AppState>,
) -> Result<project_index::SearchResults> {
    let project = state.project(&project_id)?;
    blocking(move || project_index::search(&project, &query, case_sensitive, overlays)).await
}

#[tauri::command]
async fn index_files(project_id: String, state: State<'_, AppState>) -> Result<Vec<String>> {
    let project = state.project(&project_id)?;
    blocking(move || project_index::files(&project)).await
}

#[tauri::command]
async fn list_entries(
    project_id: String,
    directory: String,
    state: State<'_, AppState>,
) -> Result<Vec<projects::Entry>> {
    let project = state.project(&project_id)?;
    blocking(move || projects::list(&project, &directory)).await
}

#[tauri::command]
async fn save_image(
    request: tauri::ipc::Request<'_>,
    state: State<'_, AppState>,
) -> Result<String> {
    let project_id = request
        .headers()
        .get("x-project-id")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing project for clipboard image.")?
        .to_string();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Expected image bytes.".into()),
    };
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = state.project(&project_id)?;
    blocking(move || images::save(&project, &bytes)).await
}

#[tauri::command]
async fn create_entry(
    project_id: String,
    path: String,
    directory: bool,
    state: State<'_, AppState>,
) -> Result<()> {
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = state.project(&project_id)?;
    blocking(move || projects::create(&project, &path, directory)).await
}

#[tauri::command]
async fn read_file(
    project_id: String,
    path: String,
    state: State<'_, AppState>,
) -> Result<projects::FileData> {
    let project = state.project(&project_id)?;
    blocking(move || projects::read(&project, &path)).await
}

#[tauri::command]
async fn save_file(
    project_id: String,
    path: String,
    text: String,
    expected_version: String,
    state: State<'_, AppState>,
) -> Result<String> {
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = state.project(&project_id)?;
    blocking(move || projects::save(&project, &path, &text, &expected_version)).await
}

#[tauri::command]
async fn toolchain_status(state: State<'_, AppState>) -> Result<builds::Toolchain> {
    Ok(state.toolchain.get_or_init(builds::discover).await.clone())
}

#[tauri::command]
async fn compile(
    project_id: String,
    root: String,
    on_log: tauri::ipc::Channel<String>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<builds::BuildResult> {
    let project;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let _operation = state.operation.lock().await;
        state.idle()?;
        project = state.project(&project_id)?;
        *state.running.lock().unwrap() = Some(cancel.clone());
    }
    // Always release the build slot, including discovery/path/process failures.
    let result = async {
        let toolchain = state.toolchain.get_or_init(builds::discover).await;
        let latexmk = toolchain
            .latexmk
            .as_ref()
            .ok_or_else(|| toolchain.message.clone())?;
        let cache = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("builds");
        let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
        let epoch = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let build_id = format!("{}-{epoch}-{sequence}", std::process::id());
        let output = builds::run(
            &project,
            &root,
            latexmk,
            &cache,
            &build_id,
            cancel,
            |chunk| {
                let _ = on_log.send(chunk);
            },
        )
        .await?;
        if let Some(path) = output.artifact {
            let old = state
                .artifact
                .lock()
                .unwrap()
                .replace((project_id, build_id, path));
            if let Some((_, _, path)) = old {
                let _ = tokio::fs::remove_file(path.with_extension("synctex.gz")).await;
                let _ = tokio::fs::remove_file(path).await;
            }
        }
        Ok(output.result)
    }
    .await;
    *state.running.lock().unwrap() = None;
    result
}

#[tauri::command]
async fn cancel_build(state: State<'_, AppState>) -> Result<()> {
    if let Some(cancel) = state.running.lock().unwrap().as_ref() {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

fn artifact_path(state: &AppState, project_id: &str, build_id: &str) -> Result<PathBuf> {
    state.project(project_id)?;
    state
        .artifact
        .lock()
        .unwrap()
        .as_ref()
        .filter(|(p, b, _)| p == project_id && b == build_id)
        .map(|(_, _, path)| path.clone())
        .ok_or("This PDF is no longer available.".into())
}

#[tauri::command]
async fn source_location(
    project_id: String,
    build_id: String,
    page: u32,
    x: f64,
    y: f64,
    state: State<'_, AppState>,
) -> Result<synctex::SourceLocation> {
    // Serialize with publication/project switching, which can remove the artifact.
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = state.project(&project_id)?;
    let pdf = artifact_path(&state, &project_id, &build_id)?;
    let tools = state.toolchain.get_or_init(builds::discover).await;
    let executable = PathBuf::from(
        tools
            .latexmk
            .as_ref()
            .ok_or("Install a TeX distribution with SyncTeX.")?,
    )
    .with_file_name("synctex");
    synctex::locate(&project, &pdf, &executable, page, x, y).await
}

#[tauri::command]
async fn read_artifact(
    project_id: String,
    build_id: String,
    state: State<'_, AppState>,
) -> Result<tauri::ipc::Response> {
    let path = artifact_path(&state, &project_id, &build_id)?;
    Ok(tauri::ipc::Response::new(
        tokio::fs::read(path).await.map_err(|e| e.to_string())?,
    ))
}

#[tauri::command]
async fn export_pdf(
    project_id: String,
    build_id: String,
    destination: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let source = artifact_path(&state, &project_id, &build_id)?;
    let destination = PathBuf::from(destination);
    if destination.extension().and_then(|s| s.to_str()) != Some("pdf") {
        return Err("Choose a .pdf export filename.".into());
    }
    blocking(move || {
        let parent = destination.parent().ok_or("Choose an export folder.")?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        let mut input = std::fs::File::open(source).map_err(|e| e.to_string())?;
        std::io::copy(&mut input, temporary.as_file_mut()).map_err(|e| e.to_string())?;
        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
        temporary.persist(destination).map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            open_project,
            list_entries,
            index_files,
            search_project,
            create_entry,
            commands::files::file_action,
            save_image,
            read_file,
            save_file,
            toolchain_status,
            compile,
            cancel_build,
            read_artifact,
            source_location,
            export_pdf,
            recent_projects,
            reload_files,
            commands::git::git_status,
            commands::git::git_action,
            commands::git::clone_repository,
            commands::git::cancel_git,
            commands::git::github_account,
            commands::git::git_diff
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Elastic");
}
