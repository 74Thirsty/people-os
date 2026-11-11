import { z } from "zod";
import { nextConfigVersion, validateCompanyConfigDocument } from "./loader";
import type { CompanyConfig } from "./schema";

export const ConfigEditSchema = z.object({
  operatingName: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().min(10).max(1000).optional(),
  website: z.string().trim().url().max(300).nullable().optional(),
  contactEmail: z.string().trim().email().max(200).nullable().optional(),
  contactTelephone: z.string().trim().min(5).max(50).nullable().optional(),
  policies: z.array(z.object({
    id: z.string().regex(/^[A-Z][A-Z0-9-]{2,30}$/),
    status: z.enum(["approved", "active", "requires_confirmation", "retired"])
  }).strict()).max(100).optional()
}).strict();

export type ConfigEdit = z.infer<typeof ConfigEditSchema>;

export class ConfigEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigEditError";
  }
}

/**
 * Applies an authorized administrative edit to a configuration snapshot.
 * Policy confirmation records who verified the policy and when; nothing is
 * silently changed without changing verification provenance.
 */
export function applyConfigEdit(
  input: CompanyConfig,
  edit: ConfigEdit,
  actor: { userId: string; now?: () => Date }
): CompanyConfig {
  const config = structuredClone(input) as CompanyConfig;
  const now = (actor.now?.() ?? new Date()).toISOString();
  const verify = (value: string | null) => ({
    value,
    status: value === null ? "requires_confirmation" as const : "verified" as const
  });

  if (edit.operatingName !== undefined) {
    config.identity.operatingName = edit.operatingName;
    config.identity.verification.fieldStatus.operatingName = "verified";
  }
  if (edit.description !== undefined) {
    config.identity.description = edit.description;
    config.identity.verification.fieldStatus.description = "verified";
  }
  if (edit.website !== undefined) {
    config.identity.website = verify(edit.website);
    config.identity.verification.fieldStatus.website = edit.website === null ? "requires_confirmation" : "verified";
  }
  if (edit.contactEmail !== undefined) {
    config.identity.contact.email = verify(edit.contactEmail);
    config.identity.verification.fieldStatus.contact = edit.contactEmail === null ? "requires_confirmation" : "verified";
  }
  if (edit.contactTelephone !== undefined) {
    config.identity.contact.telephone = verify(edit.contactTelephone);
  }

  for (const change of edit.policies ?? []) {
    const policy = config.hr.policies.find((item) => item.id === change.id);
    if (!policy) throw new ConfigEditError(`Unknown policy: ${change.id}`);
    if (policy.status === change.status) continue;
    policy.status = change.status;
    if (change.status === "approved" || change.status === "active") {
      policy.source = {
        status: "verified",
        source: `Confirmed by authorized tenant administrator ${actor.userId}`,
        verifiedAt: now,
        verifiedBy: actor.userId
      };
      policy.effectiveDate = now.slice(0, 10);
    } else if (change.status === "requires_confirmation") {
      policy.source = {
        status: "inferred",
        source: `Reverted to requires_confirmation by authorized tenant administrator ${actor.userId}`,
        verifiedAt: now,
        verifiedBy: actor.userId
      };
    }
  }

  config.identity.verification.lastReviewedAt = now;
  const nextVersion = nextConfigVersion(config.configVersion);
  const next = { ...config, configVersion: nextVersion, status: config.status };
  return validateCompanyConfigDocument(next);
}

export function configurationChangeSummary(edit: ConfigEdit): string {
  const parts: string[] = [];
  if (edit.operatingName !== undefined) parts.push("operating name");
  if (edit.description !== undefined) parts.push("description");
  if (edit.website !== undefined) parts.push("website");
  if (edit.contactEmail !== undefined) parts.push("contact email");
  if (edit.contactTelephone !== undefined) parts.push("contact telephone");
  if (edit.policies?.length) parts.push(`policy status (${edit.policies.length})`);
  return parts.length > 0 ? `Administrative configuration update: ${parts.join(", ")}` : "Administrative configuration review";
}
