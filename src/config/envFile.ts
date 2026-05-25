import { readFile, writeFile } from "node:fs/promises";

export const updateEnvFile = async (path: string, values: Record<string, string>) => {
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  const seenKeys = new Set<string>();
  const updatedLines = lines.map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);

    if (!match) {
      return line;
    }

    const key = match[1];

    if (!key || !(key in values)) {
      return line;
    }

    seenKeys.add(key);
    return `${key}=${values[key]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seenKeys.has(key)) {
      updatedLines.push(`${key}=${value}`);
    }
  }

  await writeFile(path, updatedLines.join("\n"), "utf8");
};
