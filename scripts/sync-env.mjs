#!/usr/bin/env node
// Ensures the env file is the single authoritative list of every variable used
// in the codebase. Never reads KWallet. Never prints a value.
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env.local");
const scanRoots = ["src", "scripts", "tenants", "next.config.ts", "vitest.config.mts"];

const CODE_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /(?<!process\.)\benv\.([A-Z][A-Z0-9_]*)/g,
  /"env:([A-Z][A-Z0-9_]*)"/g,
  /envValue\([^,]+,\s*"([A-Z][A-Z0-9_]*)"/g,
  /envVar\s*\?\?\s*"([A-Z][A-Z0-9_]*)"/g,
  /missing\w*\.push\("([A-Z][A-Z0-9_]*)"\)/g
];

const CREDENTIAL_PATTERNS = [
  /^eyJ[A-Za-z0-9_-]{10,}/,
  /^sb_(publishable|secret)_[A-Za-z0-9_-]{10,}/,
  /^SK[A-Za-z0-9]{16,}/,
  /^ghp_[A-Za-z0-9]{20,}/,
  /^AKIA[A-Z0-9]{12,}/,
  /^[A-Za-z0-9+/]{40,}={0,2}$/
];

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;
  const { readdirSync, statSync } = require("node:fs");
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      walk(full, files);
    } else if (/\.(ts|tsx|mjs|js|cjs|json)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function discoverCodeVars() {
  const names = new Set();
  for (const rel of scanRoots) {
    const target = resolve(root, rel);
    const files = statIsDir(target) ? walk(target) : [target];
    for (const file of files) {
      if (!existsSync(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const pattern of CODE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) names.add(match[1]);
      }
    }
  }
  return names;
}

function statIsDir(p) {
  try {
    return require("node:fs").statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function parseEnvFile(path) {
  const map = new Map();
  if (!existsSync(path)) return map;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function looksLikeCredential(value) {
  if (!value || value === "keyring" || value === "") return false;
  return CREDENTIAL_PATTERNS.some((re) => re.test(value.trim()));
}

const codeVars = discoverCodeVars();
const localVars = parseEnvFile(envFile);

const allNames = [...new Set([...codeVars, ...localVars.keys()])].sort();

let appendedLocal = 0;
for (const name of allNames) {
  if (!localVars.has(name)) {
    const suffix = existsSync(envFile) ? "\n" : "";
    appendFileSync(envFile, `${suffix}${name}=\n`);
    localVars.set(name, "");
    appendedLocal++;
  }
}

const rows = [];
let leaked = 0;
let notImported = 0;
for (const name of allNames) {
  const inCode = codeVars.has(name);
  const value = localVars.get(name) ?? "";
  const state = value === "" ? "empty" : value === "keyring" ? "keyring" : "set";
  const credential = looksLikeCredential(value);
  if (credential) leaked++;
  if (!inCode) notImported++;
  rows.push({ name, inCode, state, credential });
}

const width = Math.max(...rows.map((r) => r.name.length), 4);
console.log("Env file is the authoritative list. Values are never printed.\n");
for (const row of rows) {
  const flags = [];
  if (!row.inCode) flags.push("NOT-IMPORTED");
  if (row.credential) flags.push("CREDENTIAL-LIKE-VALUE-USE-keyring");
  console.log(`${row.name.padEnd(width)}  code:${row.inCode ? "yes" : "no "}  value:${row.state.padEnd(7)}  ${flags.join(" ")}`);
}
console.log(`\ncode vars: ${codeVars.size}  env file vars: ${localVars.size}  appended to .env.local: ${appendedLocal}`);
if (notImported) console.log(`WARNING: ${notImported} env-file variable(s) are not imported anywhere in code.`);
if (leaked) {
  console.error(`FAIL: ${leaked} variable(s) hold credential-like values. Set them to the literal marker: keyring`);
  process.exit(1);
}
console.log("OK");
