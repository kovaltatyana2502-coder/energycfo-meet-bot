import "dotenv/config";

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const rootDir = process.cwd();
const backupDir = resolve(process.env.BACKUP_DIR ?? join(rootDir, "backups"));
const retentionDays = Number.parseInt(process.env.BACKUP_RETENTION_DAYS ?? "14", 10);
const useDocker = process.env.BACKUP_USE_DOCKER === "true";
const backupMode = process.env.BACKUP_MODE ?? (useDocker ? "compose" : "local");
const postgresClientImage = process.env.POSTGRES_CLIENT_IMAGE ?? "postgres:17-alpine";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = join(backupDir, `energycfo_bot_${timestamp}.dump`);

const parseDatabaseUrl = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  return new URL(process.env.DATABASE_URL);
};

const runToFile = (command, args, env) =>
  new Promise((resolvePromise, reject) => {
    const output = createWriteStream(backupFile, { flags: "wx" });
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "inherit"],
      shell: false
    });

    child.stdout.pipe(output);
    child.on("error", reject);
    child.on("close", (code) => {
      output.close();

      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command} exited with code ${code}`));
    });
  });

const removeExpiredBackups = async () => {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = await readdir(backupDir, { withFileTypes: true });

  for (const file of files) {
    if (!file.isFile() || !/^energycfo_bot_.+\.dump$/.test(file.name)) {
      continue;
    }

    const filePath = join(backupDir, file.name);
    const fileStat = await stat(filePath);

    if (fileStat.mtimeMs < cutoff) {
      await rm(filePath);
      console.log(`Removed expired backup: ${file.name}`);
    }
  }
};

const getConnectionArgs = () => {
  const databaseUrl = parseDatabaseUrl();
  const databaseName = databaseUrl.pathname.replace(/^\//, "");

  return {
    databaseUrl,
    args: [
      `--host=${databaseUrl.hostname}`,
      `--port=${databaseUrl.port || "5432"}`,
      `--username=${decodeURIComponent(databaseUrl.username)}`,
      `--dbname=${databaseName}`,
      "--format=custom",
      "--no-owner",
      "--no-acl"
    ]
  };
};

await mkdir(backupDir, { recursive: true });

try {
  if (backupMode === "compose") {
    const postgresUser = process.env.POSTGRES_USER ?? "energycfo_bot";
    const postgresDb = process.env.POSTGRES_DB ?? "energycfo_bot";

    await runToFile(
      "docker",
      ["compose", "exec", "-T", "postgres", "pg_dump", "-U", postgresUser, "-d", postgresDb, "--format=custom", "--no-owner", "--no-acl"],
      process.env
    );
  } else if (backupMode === "docker-run") {
    const { databaseUrl, args } = getConnectionArgs();
    const dockerHostArgs = args.map((arg) =>
      arg === "--host=localhost" || arg === "--host=127.0.0.1" ? "--host=host.docker.internal" : arg
    );

    await runToFile(
      "docker",
      ["run", "--rm", "--env", "PGPASSWORD", postgresClientImage, "pg_dump", ...dockerHostArgs],
      {
        ...process.env,
        PGPASSWORD: decodeURIComponent(databaseUrl.password)
      }
    );
  } else {
    const { databaseUrl, args } = getConnectionArgs();

    await runToFile(
      "pg_dump",
      args,
      {
        ...process.env,
        PGPASSWORD: decodeURIComponent(databaseUrl.password)
      }
    );
  }

  await removeExpiredBackups();

  console.log(`Backup created: ${basename(backupFile)}`);
} catch (error) {
  await rm(backupFile, { force: true });
  throw error;
}
