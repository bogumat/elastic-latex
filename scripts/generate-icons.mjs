import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js');
const temporary = await mkdtemp(join(tmpdir(), 'elastic-icons-'));

try {
  execFileSync(
    process.execPath,
    [cli, 'icon', join(project, 'src/assets/icon.svg'), '--output', temporary],
    { cwd: project, stdio: 'inherit' },
  );
  // Keep only the formats used by this app; Tauri also generates mobile assets.
  for (const name of ['icon.icns', 'icon.png']) {
    await copyFile(join(temporary, name), join(project, 'src-tauri/icons', name));
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
