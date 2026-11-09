import { z } from "zod";
export const AgentDefinitionSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9_-]{1,48}$/),name:z.string().min(2).max(80),version:z.string().regex(/^\\d+\\.\\d+\\.\\d+$/),purpose:z.string().min(10).max(500),instructionsFile:z.string().regex(/^agents\\/[a-z0-9_-]+\\.md$/),allowedTools:z.array(z.string().regex(/^[a-z][a-z0-9_.-]+$/)).max(50),approvalRequiredFor:z.array(z.enum(["payroll_release","bank_account_change","pay_rate_change","tax_profile_change","employment_termination","policy_override"])),enabled:z.boolean().default(false)}).strict();
export type AgentDefinition=z.infer<typeof AgentDefinitionSchema>;
export function validateAgentDefinition(input:unknown):AgentDefinition{return AgentDefinitionSchema.parse(input)}
