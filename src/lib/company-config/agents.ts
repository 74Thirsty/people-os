import type { CompanyConfig } from "./schema";
import { evaluatePolicy, policiesForAgent, type PolicyEvaluation } from "./policies";

export class AgentContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentContextError";
  }
}

export interface ResolvedAgentContext {
  tenant: { slug: string; operatingName: string; configVersion: string; timezone: string };
  agent: {
    id: string;
    name: string;
    purpose: string;
    instructions: readonly string[];
    permittedActions: readonly string[];
    prohibitedActions: readonly string[];
    approvalRequiredFor: readonly string[];
    escalationConditions: readonly string[];
    channels: readonly string[];
    workflowAccess: readonly string[];
  };
  policies: PolicyEvaluation[];
  approvals: Array<{
    action: string;
    requiredRoles: string[];
    minimumApprovals: number;
    escalateTo: string | null;
  }>;
  communication: {
    provider: string;
    phoneNumber: string | null;
    channels: string[];
  };
  audit: { logReads: boolean; logActions: boolean; retentionDays: number };
}

/**
 * Company-specific instructions and policy scope are resolved from exactly one
 * active tenant configuration. There is no global agent behavior fallback.
 */
export function resolveAgentContext(config: CompanyConfig, agentId: string): ResolvedAgentContext {
  const agent = config.agents.definitions.find((item) => item.id === agentId);
  if (!agent) throw new AgentContextError(`Unknown agent for this tenant: ${agentId}`);
  if (!agent.enabled) throw new AgentContextError(`Agent ${agentId} is disabled for this tenant`);
  const policies = policiesForAgent(config, agent.policyAccess);
  const approvals = config.hr.approvals.matrix
    .filter((rule) => agent.approvalRequiredFor.includes(rule.action))
    .map((rule) => ({
      action: rule.action,
      requiredRoles: rule.requiredRoles,
      minimumApprovals: rule.minimumApprovals,
      escalateTo: rule.escalateTo
    }));
  return {
    tenant: {
      slug: config.identity.slug,
      operatingName: config.identity.operatingName,
      configVersion: config.configVersion,
      timezone: config.identity.timezone
    },
    agent: {
      id: agent.id,
      name: agent.name,
      purpose: agent.purpose,
      instructions: agent.instructions,
      permittedActions: agent.permittedActions,
      prohibitedActions: agent.prohibitedActions,
      approvalRequiredFor: agent.approvalRequiredFor,
      escalationConditions: agent.escalationConditions,
      channels: agent.channels,
      workflowAccess: agent.workflowAccess
    },
    policies,
    approvals,
    communication: {
      provider: config.communications.provider,
      phoneNumber: config.communications.phoneNumber.e164.value,
      channels: (["sms", "mms", "voice"] as const).filter(
        (capability) => config.communications.phoneNumber.verifiedCapabilities[capability]
      )
    },
    audit: agent.audit
  };
}

export interface AgentActionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export function authorizeAgentAction(
  config: CompanyConfig,
  agentId: string,
  action: string
): AgentActionDecision {
  const agent = config.agents.definitions.find((item) => item.id === agentId);
  if (!agent) throw new AgentContextError(`Unknown agent for this tenant: ${agentId}`);
  if (!agent.enabled) return { allowed: false, requiresApproval: false, reason: "Agent is disabled" };
  if (agent.prohibitedActions.includes(action)) {
    return { allowed: false, requiresApproval: false, reason: `Agent is explicitly prohibited from ${action}` };
  }
  if (!agent.permittedActions.includes(action)) {
    return { allowed: false, requiresApproval: false, reason: `Agent is not permitted to perform ${action}` };
  }
  if (agent.approvalRequiredFor.includes(action)) {
    return { allowed: true, requiresApproval: true, reason: `${action} requires configured human approval` };
  }
  return { allowed: true, requiresApproval: false, reason: `${action} is permitted without additional approval` };
}

/** Resolves the policy guard view an agent may use for a specific policy. */
export function evaluateAgentPolicy(config: CompanyConfig, agentId: string, policyId: string): PolicyEvaluation {
  const agent = config.agents.definitions.find((item) => item.id === agentId);
  if (!agent) throw new AgentContextError(`Unknown agent: ${agentId}`);
  const allowed = agent.policyAccess.includes("*") || agent.policyAccess.includes("all") || agent.policyAccess.includes(policyId);
  if (!allowed) throw new AgentContextError(`Agent ${agentId} has no access to policy ${policyId}`);
  return evaluatePolicy(config, policyId);
}
