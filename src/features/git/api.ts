import { invoke } from '@tauri-apps/api/core';

export interface Change {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
}
export interface Remote {
  name: string;
  url: string;
  push_url: string;
}
export interface GitStatus {
  repository: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: Change[];
  remotes: Remote[];
  conflicted: boolean;
  merging: boolean;
}
export type GitAction = 'init' | 'commit' | 'fetch' | 'pull' | 'push' | 'fork';
export const git = {
  status: (projectId: string) => invoke<GitStatus>('git_status', { projectId }),
  action: (projectId: string, action: GitAction, remote = '', message = '') =>
    invoke<string>('git_action', { projectId, action, remote, message }),
  diff: (projectId: string, path: string) => invoke<string>('git_diff', { projectId, path }),
  clone: (url: string, parent: string, name: string, fork: boolean) =>
    invoke<string>('clone_repository', { url, parent, name, fork }),
  cancel: () => invoke<void>('cancel_git'),
  account: () => invoke<string>('github_account'),
};
