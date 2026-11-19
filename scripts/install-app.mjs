import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(project, 'src-tauri/target/release/bundle/macos/Elastic.app');
const applications = join(homedir(), 'Applications');
const destination = join(applications, 'Elastic.app');
const identifier = 'dev.elastic.editor';

function checkBundle(path) {
  const actual = execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :CFBundleIdentifier', join(path, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
  if (actual !== identifier)
    throw new Error(`Refusing to replace an unrelated application: ${path}`);
}

async function install() {
  if (process.platform !== 'darwin') throw new Error('Local app installation requires macOS.');
  checkBundle(source);
  await mkdir(applications, { recursive: true });
  let exists = false;
  try {
    const info = await lstat(destination);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error(`Expected an application directory at ${destination}`);
    checkBundle(destination);
    exists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  // Stage beside the destination so both renames stay on the same filesystem.
  // A failed build/copy leaves the installed app untouched; failed replacement
  // restores the previous bundle before reporting the error.
  const temporary = await mkdtemp(join(applications, '.elastic-update-'));
  const staged = join(temporary, 'Elastic.app');
  const previous = join(temporary, 'previous.app');
  let movedPrevious = false;
  try {
    execFileSync('/usr/bin/ditto', [source, staged]);
    checkBundle(staged);
    if (exists) {
      await rename(destination, previous);
      movedPrevious = true;
    }
    try {
      await rename(staged, destination);
    } catch (error) {
      if (movedPrevious) {
        try {
          await rename(previous, destination);
          movedPrevious = false;
        } catch (restoreError) {
          throw new Error(`Could not restore the previous app. It is preserved at ${previous}`, {
            cause: restoreError,
          });
        }
      }
      throw error;
    }
    movedPrevious = false;
  } finally {
    // Preserve the backup if restoring it failed.
    if (!movedPrevious) await rm(temporary, { recursive: true, force: true });
  }

  console.log(`Installed ${destination}`);
  try {
    execFileSync(
      '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister',
      ['-f', destination],
    );
  } catch {
    console.warn(
      'Installed successfully, but macOS application registration failed. Open the app once from Applications.',
    );
  }
  console.log('Restart Elastic if it is running to load the new build.');
}

install().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
