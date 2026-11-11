import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateCompanyConfigJsonSchema } from "./json-schema";
import { CompanyConfigSchema, assertNoInlineSecrets, type CompanyConfig } from "./schema";

export class CompanyConfigValidationError extends Error {
  readonly issues: string[];
  readonly file: string | null;

  constructor(message: string, issues: string[], file: string | null = null) {
    super(message);
    this.name = "CompanyConfigValidationError";
    this.issues = issues;
    this.file = file;
  }
}

export interface LoadedCompanyConfig {
  config: CompanyConfig;
  file: string;
  hash: string;
  raw: unknown;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,48}$/;

export function assertConfigSlug(slug: string): void {
  if (!SLUG_PATTERN.test(slug)) {
    throw new CompanyConfigValidationError("Invalid company configuration slug", [
      "slug must match ^[a-z][a-z0-9-]{1,48}$"
    ]);
  }
}

/** Deterministic JSON so content hashes do not depend on property order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashCompanyConfig(config: unknown): string {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

export function validateCompanyConfigDocument(input: unknown, file: string | null = null): CompanyConfig {
  const schemaIssues = validateCompanyConfigJsonSchema(input);
  if (schemaIssues.length > 0) {
    throw new CompanyConfigValidationError(
      "Company configuration does not satisfy the universal JSON Schema",
      schemaIssues,
      file
    );
  }
  try {
    assertNoInlineSecrets(input);
  } catch (error) {
    throw new CompanyConfigValidationError(
      "Company configuration contains an inline secret",
      [error instanceof Error ? error.message : "Inline secret rejected"],
      file
    );
  }
  const parsed = CompanyConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw new CompanyConfigValidationError(
      "Company configuration violates cross-field policy or security rules",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`),
      file
    );
  }
  return parsed.data;
}

export function parseCompanyConfigJson(text: string, file: string | null = null): LoadedCompanyConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new CompanyConfigValidationError(
      "Company configuration is not valid JSON",
      [error instanceof Error ? error.message : "JSON parse failed"],
      file
    );
  }
  const config = validateCompanyConfigDocument(raw, file);
  return { config, file: file ?? "", hash: hashCompanyConfig(config), raw };
}

export function loadCompanyConfigFile(file: string): LoadedCompanyConfig {
  if (!existsSync(file)) {
    throw new CompanyConfigValidationError("Company configuration file does not exist", [file], file);
  }
  return parseCompanyConfigJson(readFileSync(file, "utf8"), file);
}

export function tenantConfigPath(root: string, slug: string): string {
  assertConfigSlug(slug);
  return path.join(root, slug, "company.json");
}

export function loadRepositoryCompanyConfig(
  slug: string,
  root = path.join(process.cwd(), "tenants")
): LoadedCompanyConfig {
  const file = tenantConfigPath(root, slug);
  const loaded = loadCompanyConfigFile(file);
  if (loaded.config.identity.slug !== slug) {
    throw new CompanyConfigValidationError(
      "Configuration slug does not match its tenant directory",
      [`identity.slug=${loaded.config.identity.slug} directory=${slug}`],
      file
    );
  }
  return loaded;
}

export interface RepositoryConfigSummary {
  slug: string;
  file: string;
  configVersion: string | null;
  status: CompanyConfig["status"] | null;
  hash: string | null;
  error: string | null;
}

/**
 * Lists repository configurations without trusting filenames alone.
 * Invalid configurations are reported, never silently skipped.
 */
export function listRepositoryCompanyConfigs(
  root = path.join(process.cwd(), "tenants")
): RepositoryConfigSummary[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "template" &&
      !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const slug = entry.name;
      const file = path.join(root, slug, "company.json");
      if (!existsSync(file)) {
        return { slug, file, configVersion: null, status: null, hash: null, error: "Missing company.json" };
      }
      try {
        assertConfigSlug(slug);
        const loaded = loadCompanyConfigFile(file);
        const mismatch = loaded.config.identity.slug !== slug
          ? `identity.slug=${loaded.config.identity.slug} does not match directory`
          : null;
        return {
          slug,
          file,
          configVersion: loaded.config.configVersion,
          status: loaded.config.status,
          hash: loaded.hash,
          error: mismatch
        };
      } catch (error) {
        return {
          slug,
          file,
          configVersion: null,
          status: null,
          hash: null,
          error: error instanceof Error ? error.message : "Invalid configuration"
        };
      }
    });
}

/** Increment a configuration's patch version for an immutable change snapshot. */
export function nextConfigVersion(current: string, bump: "patch" | "minor" = "patch"): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error("Current configuration version is not semantic");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}
