import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

import { config } from "./config.js";
import { db } from "./db.js";

async function run(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
  });
}

export async function createEncryptedBackup() {
  if (!config.backupAgeRecipient) return { skipped: true };
  fs.mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const plain = path.join(config.backupDir, `bike-${stamp}.sqlite`);
  const encrypted = `${plain}.age`;
  await db.backup(plain);
  try {
    await run("age", ["-r", config.backupAgeRecipient, "-o", encrypted, plain]);
  } finally {
    fs.rmSync(plain, { force: true });
  }
  const files = fs
    .readdirSync(config.backupDir)
    .filter((file) => file.endsWith(".sqlite.age"))
    .sort()
    .reverse();
  files.slice(7).forEach((file) => fs.rmSync(path.join(config.backupDir, file), { force: true }));
  return { skipped: false, file: encrypted };
}

export function scheduleBackups(log: { info: (value: unknown, message: string) => void; error: (value: unknown, message: string) => void }) {
  const day = 86_400_000;
  const timer = setInterval(() => {
    createEncryptedBackup()
      .then((result) => log.info(result, "Backup cycle completed"))
      .catch((error) => log.error({ err: error }, "Backup cycle failed"));
  }, day);
  timer.unref();
}
