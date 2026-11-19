import { Channel, invoke, isTauri } from '@tauri-apps/api/core';

export interface Project {
  id: string;
  name: string;
  path?: string;
}
export interface Entry {
  path: string;
  name: string;
  directory: boolean;
}
export interface FileData {
  text: string;
  version: string;
  lineEnding: string;
}
export interface Toolchain {
  available: boolean;
  latexmk: string | null;
  message: string;
}
export interface Diagnostic {
  path: string;
  line: number;
  message: string;
}
export interface BuildResult {
  projectId: string;
  buildId: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  diagnostics: Diagnostic[];
  log: string;
  elapsedMs: number;
}
export interface Backend {
  openProject(path: string): Promise<Project>;
  listEntries(projectId: string, directory: string): Promise<Entry[]>;
  createEntry(projectId: string, path: string, directory: boolean): Promise<void>;
  saveImage(projectId: string, bytes: Uint8Array): Promise<string>;
  readFile(projectId: string, path: string): Promise<FileData>;
  saveFile(projectId: string, path: string, text: string, expectedVersion: string): Promise<string>;
  toolchain(): Promise<Toolchain>;
  compile(projectId: string, root: string, onLog: (text: string) => void): Promise<BuildResult>;
  cancel(): Promise<void>;
  readArtifact(projectId: string, buildId: string): Promise<ArrayBuffer>;
  sourceLocation(
    projectId: string,
    buildId: string,
    page: number,
    x: number,
    y: number,
  ): Promise<{ path: string; line: number }>;
  exportPdf(projectId: string, buildId: string, destination: string): Promise<void>;
  reloadFiles(projectId: string, paths: string[]): Promise<Record<string, FileData | null>>;
}
export const desktop = isTauri();
export const backend: Backend = {
  openProject: (path) => invoke('open_project', { path }),
  listEntries: (projectId, directory) => invoke('list_entries', { projectId, directory }),
  createEntry: (projectId, path, directory) =>
    invoke('create_entry', { projectId, path, directory }),
  saveImage: (projectId, bytes) =>
    invoke('save_image', bytes, { headers: { 'x-project-id': projectId } }),
  readFile: (projectId, path) => invoke('read_file', { projectId, path }),
  saveFile: (projectId, path, text, expectedVersion) =>
    invoke('save_file', { projectId, path, text, expectedVersion }),
  toolchain: () => invoke('toolchain_status'),
  compile: (projectId, root, onLog) => {
    const onLogChannel = new Channel<string>();
    onLogChannel.onmessage = onLog;
    return invoke('compile', { projectId, root, onLog: onLogChannel });
  },
  cancel: () => invoke('cancel_build'),
  readArtifact: (projectId, buildId) => invoke('read_artifact', { projectId, buildId }),
  sourceLocation: (projectId, buildId, page, x, y) =>
    invoke('source_location', { projectId, buildId, page, x, y }),
  exportPdf: (projectId, buildId, destination) =>
    invoke('export_pdf', { projectId, buildId, destination }),
  reloadFiles: (projectId, paths) => invoke('reload_files', { projectId, paths }),
};
export interface RecentProject {
  name: string;
  path: string;
}
export const recentProjects = () => invoke<RecentProject[]>('recent_projects');
