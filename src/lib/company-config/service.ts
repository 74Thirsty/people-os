import { validateCompanyConfigDocument, hashCompanyConfig } from "./loader";
import type { CompanyConfig } from "./schema";
import { roleForMembership } from "./access";
import type { WorkforceRole } from "./schema";

export class CompanyConfigNotFoundError extends Error {
  constructor(tenantId: string) {
    super(`No active company configuration for tenant ${tenantId}`);
    this.name = "CompanyConfigNotFoundError";
  }
}

export class CompanyConfigAccessError extends Error {
  constructor(message = "Tenant configuration access denied") {
    super(message);
    this.name = "CompanyConfigAccessError";
  }
}

export class CompanyConfigIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyConfigIntegrityError";
  }
}

export interface StoredConfigVersion {
  tenantId: string;
  version: string;
  hash: string;
  config: unknown;
  status: "draft" | "active" | "superseded" | "retired";
  source: "repository" | "admin";
  createdAt: string;
  createdBy: string | null;
}

export interface ActiveConfigStore {
  loadActiveConfigVersion(tenantId: string): Promise<StoredConfigVersion | null>;
}

export interface MembershipStore {
  loadMembership(tenantId: string, userId: string): Promise<{ role: string } | null>;
}

export interface ResolvedTenantConfig {
  tenantId: string;
  version: string;
  hash: string;
  source: StoredConfigVersion["source"];
  createdAt: string;
  config: CompanyConfig;
}

/**
 * Tenant-aware configuration resolution. The persisted hash is verified on every
 * load so a mutated database row cannot silently alter company behavior.
 */
export function createCompanyConfigService(store: ActiveConfigStore, memberships?: MembershipStore) {
  async function resolveActive(tenantId: string): Promise<ResolvedTenantConfig> {
    if (!tenantId.trim()) throw new CompanyConfigAccessError("tenantId is required");
    const stored = await store.loadActiveConfigVersion(tenantId);
    if (!stored) throw new CompanyConfigNotFoundError(tenantId);
    if (stored.tenantId !== tenantId) {
      throw new CompanyConfigIntegrityError("Configuration row belongs to a different tenant");
    }
    if (stored.status !== "active") {
      throw new CompanyConfigIntegrityError("Only an active configuration version may drive behavior");
    }
    const config = validateCompanyConfigDocument(stored.config);
    const actualHash = hashCompanyConfig(config);
    if (actualHash !== stored.hash.toLowerCase()) {
      throw new CompanyConfigIntegrityError("Configuration content hash does not match the stored version");
    }
    return {
      tenantId,
      version: stored.version,
      hash: stored.hash,
      source: stored.source,
      createdAt: stored.createdAt,
      config
    };
  }

  return Object.freeze({
    resolveActive,
    async resolveForMembership(
      tenantId: string,
      userId: string
    ): Promise<ResolvedTenantConfig & { membershipRole: string; role: WorkforceRole | null }> {
      if (!memberships) throw new CompanyConfigAccessError("Membership authorization is not configured");
      if (!userId) throw new CompanyConfigAccessError("Authenticated user is required");
      const membership = await memberships.loadMembership(tenantId, userId);
      if (!membership) throw new CompanyConfigAccessError();
      const resolved = await resolveActive(tenantId);
      return {
        ...resolved,
        membershipRole: membership.role,
        role: roleForMembership(resolved.config, membership.role)
      };
    }
  });
}
