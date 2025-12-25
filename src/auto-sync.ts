/**
 * Auto-sync module for repo-depot updates
 *
 * Automatically checks for and pulls updates from repo-depot on CLI startup.
 * Uses a cache to avoid checking on every single command.
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_DEPOT_URL = 'https://github.com/bizzlechizzle/repo-depot';
const DEPOT_CACHE = path.join(os.homedir(), '.cache', 'repo-depot');
const CHECK_CACHE_FILE = path.join(os.homedir(), '.cache', 'mapsh-pit-sync-check');
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

interface SyncResult {
  checked: boolean;
  updated: boolean;
  version: string | null;
  error: string | null;
}

/**
 * Get the root directory of mapsh-pit (where CLAUDE.md should go)
 */
function getProjectRoot(): string | null {
  // Try to find package.json to locate project root
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.name === 'mapsh-pit') {
          return dir;
        }
      } catch {
        // Continue searching
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Check if we should run a sync check (rate limited)
 */
function shouldCheck(): boolean {
  try {
    if (!fs.existsSync(CHECK_CACHE_FILE)) {
      return true;
    }
    const lastCheck = parseInt(fs.readFileSync(CHECK_CACHE_FILE, 'utf-8'), 10);
    return Date.now() - lastCheck > CHECK_INTERVAL_MS;
  } catch {
    return true;
  }
}

/**
 * Mark that we just checked
 */
function markChecked(): void {
  try {
    const cacheDir = path.dirname(CHECK_CACHE_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(CHECK_CACHE_FILE, Date.now().toString());
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Ensure repo-depot cache exists and is up to date
 */
function ensureDepotCache(): boolean {
  try {
    const cacheDir = path.dirname(DEPOT_CACHE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (!fs.existsSync(path.join(DEPOT_CACHE, '.git'))) {
      // Clone repo-depot
      execSync(`git clone --quiet "${REPO_DEPOT_URL}" "${DEPOT_CACHE}"`, {
        stdio: 'pipe',
        timeout: 30000,
      });
    } else {
      // Pull latest
      execSync('git fetch origin --quiet && git checkout main --quiet 2>/dev/null; git pull origin main --quiet', {
        cwd: DEPOT_CACHE,
        stdio: 'pipe',
        timeout: 30000,
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the depot version string
 */
function getDepotVersion(): string | null {
  try {
    const versionFile = path.join(DEPOT_CACHE, 'VERSION');
    if (!fs.existsSync(versionFile)) return null;

    const version = fs.readFileSync(versionFile, 'utf-8').trim();
    const result = spawnSync('git', ['rev-list', '--count', 'HEAD'], {
      cwd: DEPOT_CACHE,
      encoding: 'utf-8',
    });
    const commitCount = result.stdout?.trim() || '0';
    return `${version}.${commitCount}`;
  } catch {
    return null;
  }
}

/**
 * Get the current synced version
 */
function getCurrentVersion(projectRoot: string): string | null {
  try {
    const versionFile = path.join(projectRoot, '.depot-version');
    if (!fs.existsSync(versionFile)) return null;
    return fs.readFileSync(versionFile, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Sync files from repo-depot to project
 */
function syncFiles(projectRoot: string, remoteVersion: string): boolean {
  try {
    // Sync CLAUDE.md
    const claudeSrc = path.join(DEPOT_CACHE, 'CLAUDE.md');
    const claudeDest = path.join(projectRoot, 'CLAUDE.md');
    if (fs.existsSync(claudeSrc)) {
      fs.copyFileSync(claudeSrc, claudeDest);
    }

    // Sync skills
    const skillsSrc = path.join(DEPOT_CACHE, 'skills');
    const skillsDest = path.join(projectRoot, '.claude', 'skills');
    if (fs.existsSync(skillsSrc)) {
      if (!fs.existsSync(skillsDest)) {
        fs.mkdirSync(skillsDest, { recursive: true });
      }
      const skills = fs.readdirSync(skillsSrc);
      for (const skill of skills) {
        const srcPath = path.join(skillsSrc, skill);
        const destPath = path.join(skillsDest, skill);
        if (fs.statSync(srcPath).isDirectory()) {
          fs.cpSync(srcPath, destPath, { recursive: true });
        }
      }
    }

    // Update version file
    fs.writeFileSync(path.join(projectRoot, '.depot-version'), remoteVersion);

    return true;
  } catch {
    return false;
  }
}

/**
 * Run auto-sync check (non-blocking, silent unless update found)
 */
export async function autoSync(): Promise<SyncResult> {
  const result: SyncResult = {
    checked: false,
    updated: false,
    version: null,
    error: null,
  };

  // Rate limit checks
  if (!shouldCheck()) {
    return result;
  }

  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    // Running from global install or can't find project root
    // Just mark checked and skip
    markChecked();
    return result;
  }

  result.checked = true;

  try {
    // Ensure cache is up to date
    if (!ensureDepotCache()) {
      result.error = 'Failed to update repo-depot cache';
      markChecked();
      return result;
    }

    const currentVersion = getCurrentVersion(projectRoot);
    const remoteVersion = getDepotVersion();

    if (!remoteVersion) {
      result.error = 'Could not determine repo-depot version';
      markChecked();
      return result;
    }

    result.version = remoteVersion;

    // Check if update needed
    if (currentVersion !== remoteVersion) {
      if (syncFiles(projectRoot, remoteVersion)) {
        result.updated = true;
      } else {
        result.error = 'Failed to sync files';
      }
    }

    markChecked();
  } catch (err) {
    result.error = err instanceof Error ? err.message : 'Unknown error';
    markChecked();
  }

  return result;
}

/**
 * Run sync and print status message if updated
 */
export async function autoSyncWithMessage(): Promise<void> {
  try {
    const result = await autoSync();
    if (result.updated && result.version) {
      console.error(`\x1b[32m[repo-depot]\x1b[0m Updated to v${result.version}`);
    }
  } catch {
    // Silent failure - don't interrupt CLI
  }
}
