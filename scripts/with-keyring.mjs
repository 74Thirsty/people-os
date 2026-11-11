#!/usr/bin/env node
// Launches a command with `keyring` markers from the env file resolved to their
// real values from KWallet (wallet kdewallet, folder PEOPLEOS, entry = variable name).
// Values never touch disk, never printed. Missing wallet entries are skipped silently.
// CI-safe: no .env.local and no kwallet-query -> runs the command unchanged.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.local");
const wallet = "kdewallet";
const folder = "PEOPLEOS";

function readWalletEntry(entry) {
  try {
    const out = execFileSync("kwallet-query", ["-f", folder, "-r", entry, wallet], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10000
    });
    const value = (out || "").trim();
    if (!value || value.includes("Failed to read") || value.includes("does not exist")) return null;
    return value;
  } catch {
    return null;
  }
}

const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, name, raw] = match;
    const value = raw.trim();
    if (value !== "keyring") continue;
    if (env[name] && env[name] !== "keyring") continue; // real value already provided externally
    const resolved = readWalletEntry(name);
    if (resolved !== null) env[name] = resolved;
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-keyring.mjs <command> [args...]");
  process.exit(2);
}
const child = spawn(command, args, { stdio: "inherit", env, cwd: root });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
