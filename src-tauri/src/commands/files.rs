use crate::{blocking, file_actions, projects::Result, AppState};
use tauri::State;

#[tauri::command]
pub async fn file_action(
    project_id: String,
    action: file_actions::Action,
    path: String,
    destination: String,
    state: State<'_, AppState>,
) -> Result<()> {
    let _operation = state.operation.lock().await;
    state.idle()?;
    let project = state.project(&project_id)?;
    blocking(move || file_actions::run(&project, action, &path, &destination)).await
}
