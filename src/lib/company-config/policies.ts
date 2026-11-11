import type { CompanyConfig, Policy } from "./schema";

export class UnknownPolicyError extends Error {
  constructor(policyId: string) {
    super(`Unknown policy: ${policyId}`);
    this.name = "UnknownPolicyError";
  }
}

export type PolicyGuardOutcome = "permit" | "deny" | "requires_approval" | "advisory";

export interface PolicyEvaluation {
  policyId: string;
  name: string;
  status: Policy["status"];
  enforceable: boolean;
  mode: Policy["enforcement"]["mode"];
  outcome: PolicyGuardOutcome;
  reason: string;
}

export function getPolicy(config: CompanyConfig, policyId: string): Policy {
  const policy = config.hr.policies.find((item) => item.id === policyId);
  if (!policy) throw new UnknownPolicyError(policyId);
  return policy;
}

/**
 * Only approved/active policies with verified or explicit example provenance
 * are enforceable. Inferred policies can never silently block or auto-approve.
 */
export function evaluatePolicy(config: CompanyConfig, policyId: string): PolicyEvaluation {
  const policy = getPolicy(config, policyId);
  const confirmed = policy.status === "active" || policy.status === "approved";
  const provenanceConfirmed = policy.source.status === "verified" || policy.source.status === "example";
  const enforceable = confirmed && provenanceConfirmed;
  if (!enforceable) {
    return {
      policyId,
      name: policy.name,
      status: policy.status,
      enforceable: false,
      mode: "advisory",
      outcome: "advisory",
      reason: `Policy ${policyId} is ${policy.status} with ${policy.source.status} provenance; it is advisory until confirmed`
    };
  }
  switch (policy.enforcement.mode) {
    case "auto":
      return { policyId, name: policy.name, status: policy.status, enforceable, mode: policy.enforcement.mode, outcome: "permit", reason: policy.enforcement.behavior };
    case "block":
      return { policyId, name: policy.name, status: policy.status, enforceable, mode: policy.enforcement.mode, outcome: "deny", reason: policy.enforcement.behavior };
    case "require_approval":
      return { policyId, name: policy.name, status: policy.status, enforceable, mode: policy.enforcement.mode, outcome: "requires_approval", reason: policy.enforcement.behavior };
    case "advisory":
      return { policyId, name: policy.name, status: policy.status, enforceable, mode: policy.enforcement.mode, outcome: "advisory", reason: policy.enforcement.behavior };
  }
}

export function policiesForAgent(config: CompanyConfig, policyAccess: string[]): PolicyEvaluation[] {
  const all = policyAccess.includes("*") || policyAccess.includes("all");
  return config.hr.policies
    .filter((policy) => all || policyAccess.includes(policy.id))
    .map((policy) => evaluatePolicy(config, policy.id));
}

export function policyGaps(config: CompanyConfig) {
  return {
    requiringConfirmation: config.hr.policies
      .filter((policy) => policy.status === "proposed" || policy.status === "requires_confirmation")
      .map((policy) => ({ id: policy.id, name: policy.name, source: policy.source.status })),
    unverifiedSources: config.hr.policies
      .filter((policy) => policy.source.status === "inferred" || policy.source.status === "requires_confirmation")
      .map((policy) => ({ id: policy.id, status: policy.status, source: policy.source.source }))
  };
}
