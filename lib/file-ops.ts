import fs from "fs";
import path from "path";
import os from "os";

// Data directory priority: env var > XDG Base Directory > fallback
// Set DATA_DIR to override the default XDG location
const XDG_DATA_HOME =
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
export const dataDir =
  process.env.DATA_DIR || path.join(XDG_DATA_HOME, "ai-subscriptions");

export function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function backupFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${filePath}.backup-${timestamp}`;

  try {
    fs.copyFileSync(filePath, backupPath);
    console.log(`Backup created: ${backupPath}`);

    cleanOldBackups(filePath);
  } catch (error) {
    console.error(`Failed to create backup for ${filePath}:`, error);
  }
}

function cleanOldBackups(filePath: string, keepCount: number = 10): void {
  const dir = path.dirname(filePath);
  const baseName = path.basename(filePath);

  try {
    const files = fs.readdirSync(dir);
    const backupFiles = files
      .filter((f) => f.startsWith(baseName) && f.includes(".backup-"))
      .sort()
      .reverse();

    const toDelete = backupFiles.slice(keepCount);

    for (const file of toDelete) {
      const fullPath = path.join(dir, file);
      fs.unlinkSync(fullPath);
      console.log(`Deleted old backup: ${file}`);
    }
  } catch (error) {
    console.error(`Failed to clean old backups for ${filePath}:`, error);
  }
}

export function atomicWriteFile(filePath: string, data: string): void {
  backupFile(filePath);

  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}
