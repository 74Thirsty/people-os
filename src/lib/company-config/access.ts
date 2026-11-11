import type { ApprovalRule, CompanyConfig, WorkforceRole } from "./schema";

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class ApprovalConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalConfigurationError";
  }
}

export function getRole(config: CompanyConfig, roleId: string): WorkforceRole {
  const role = config.workforce.roles.find((item) => item.id === roleId);
  if (!role) throw new AuthorizationError(`Unknown tenant role: ${roleId}`);
  return role;
}

export function roleForMembership(
  config: CompanyConfig,
  membershipRole: string
): WorkforceRole | null {
  return config.workforce.roles.find((role) => role.membershipRole === membershipRole) ?? null;
}

export function roleHasPermission(role: WorkforceRole, permission: string): boolean {
  for (const granted of role.permissions) {
    if (granted === "*" || granted === permission) return true;
    if (granted.endsWith(".*") && permission.startsWith(granted.slice(0, -1))) return true;
  }
  return false;
}

export function assertPermission(config: CompanyConfig, roleId: string, permission: string): WorkforceRole {
  const role = getRole(config, roleId);
  if (!roleHasPermission(role, permission)) {
    throw new AuthorizationError(`Role ${roleId} does not have permission ${permission}`);
  }
  return role;
}

export function getApprovalRule(config: CompanyConfig, action: string): ApprovalRule {
  const rule = config.hr.approvals.matrix.find((item) => item.action === action);
  if (!rule) throw new ApprovalConfigurationError(`No approval matrix rule for action: ${action}`);
  return rule;
}

export interface ApprovalDecision {
  action: string;
  allowed: boolean;
  requiredRoles: string[];
  minimumApprovals: number;
  escalateTo: string | null;
  reason: string;
}

/**
 * Checks whether a role may approve an action. Amount escalation is explicit:
 * an approver above the configured threshold must be the escalation role.
 */
export function authorizeApproval(
  config: CompanyConfig,
  action: string,
  actorRoleId: string,
  amount?: number
): ApprovalDecision {
  const rule = getApprovalRule(config, action);
  getRole(config, actorRoleId);
  const base = {
    action,
    requiredRoles: rule.requiredRoles,
    minimumApprovals: rule.minimumApprovals,
    escalateTo: rule.escalateTo
  };
  if (!Number.isFinite(amount ?? 0) || (amount ?? 0) < 0) {
    return { ...base, allowed: false, reason: "Approval amount must be a non-negative number" };
  }
  if (amount !== undefined && rule.amountThreshold !== null && amount > rule.amountThreshold) {
    if (rule.escalateTo !== null && actorRoleId === rule.escalateTo) {
      return { ...base, allowed: true, reason: `Role ${actorRoleId} may approve the escalated amount for ${action}` };
    }
    return {
      ...base,
      allowed: false,
      reason: `Amount ${amount} exceeds the ${rule.amountThreshold} threshold; approval by ${rule.escalateTo ?? "a higher authority"} is required`
    };
  }
  if (!rule.requiredRoles.includes(actorRoleId)) {
    return { ...base, allowed: false, reason: `Role ${actorRoleId} is not authorized to approve ${action}` };
  }
  return { ...base, allowed: true, reason: `Role ${actorRoleId} may approve ${action}` };
}

export function approvalAuthority(config: CompanyConfig, roleId: string) {
  return config.workforce.approvalHierarchy
    .filter((level) => level.roleId === roleId)
    .sort((left, right) => left.level - right.level);
}

export function canAccessData(
  config: CompanyConfig,
  roleId: string,
  dataset: "employeeRecords" | "compensation" | "documents" | "messages",
  scope: "self" | "team" | "all"
): boolean {
  const access = getRole(config, roleId).dataAccess[dataset];
  if (access === "none") return false;
  if (scope === "all") return access === "all";
  if (scope === "team") return access === "all" || access === "team";
  return access === "all" || access === "team" || access === "self";
}
