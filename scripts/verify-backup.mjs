import "dotenv/config";

import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const backupDir = resolve(process.env.BACKUP_DIR ?? join(rootDir, "backups"));
const useDocker = process.env.BACKUP_VERIFY_USE_DOCKER === "true";
const postgresClientImage = process.env.POSTGRES_CLIENT_IMAGE ?? "postgres:17-alpine";

const findLatestBackup = async () => {
  const files = await readdir(backupDir, { withFileTypes: true });
  const backups = files
    .filter((file) => file.isFile() && /^energycfo_bot_.+\.dump$/.test(file.name))
    .map((file) => file.name)
    .sort();

  return backups.at(-1) ?? null;
};

const backupArg = process.argv[2];
const backupName = backupArg ? basename(backupArg) : await findLatestBackup();

if (!backupName) {
  throw new Error("Backup file not found");
}

const backupPath = join(backupDir, backupName);

const runCommand = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "inherit"],
      shell: false
    });
    let output = "";

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));
        return;
      }

      resolve(output);
    });
  });

const output = useDocker
  ? await runCommand("docker", [
      "run",
      "--rm",
      "-v",
      `${backupDir.replaceAll("\\", "/")}:/backup:ro`,
      postgresClientImage,
      "pg_restore",
      "--list",
      `/backup/${backupName}`
    ])
  : await runCommand("pg_restore", ["--list", backupPath]);

const lines = output.split(/\r?\n/).filter(Boolean);

if (lines.length === 0) {
  throw new Error("Backup verification failed: pg_restore returned empty object list");
}

console.log(`Backup verified: ${backupName}`);
console.log(`Objects listed: ${lines.length}`);
