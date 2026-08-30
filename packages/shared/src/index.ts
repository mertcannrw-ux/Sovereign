import { z } from 'zod';

// ─── Enums (mirror Prisma enums) ────────────────────────

export const ProjectStatus = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ProjectRole = z.enum(['OWNER', 'EDITOR', 'VIEWER']);
export type ProjectRole = z.infer<typeof ProjectRole>;

export const OrganizationRole = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export type OrganizationRole = z.infer<typeof OrganizationRole>;

export const DeploymentStatus = z.enum([
  'QUEUED',
  'BUILDING',
  'DEPLOYING',
  'LIVE',
  'FAILED',
  'CANCELED',
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

export const JobStatus = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED']);
export type JobStatus = z.infer<typeof JobStatus>;

export const SubscriptionStatus = z.enum([
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'CANCELED',
  'INCOMPLETE',
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const FileOperation = z.enum(['CREATE', 'UPDATE', 'DELETE']);
export type FileOperation = z.infer<typeof FileOperation>;

// ─── User & Auth ────────────────────────────────────────

export const AuthProvider = z.enum(['email', 'google', 'github', 'saml']);
export type AuthProvider = z.infer<typeof AuthProvider>;

export interface User {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  emailVerified?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── AI Providers (BYOK) ────────────────────────────────

export const AIProvider = z.enum(['openai', 'anthropic', 'google', 'mistral', 'groq', 'ollama', 'custom']);
export type AIProvider = z.infer<typeof AIProvider>;

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  mistral: 'Mistral',
  groq: 'Groq',
  ollama: 'Ollama (Local)',
  custom: 'Custom (OpenAI Compatible)',
};

export interface ApiKey {
  id: string;
  userId: string;
  provider: string;
  label?: string | null;
  baseUrl?: string | null;
  createdAt: Date;
  lastUsedAt?: Date | null;
}

// ─── Organizations ──────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: Date;
}

// ─── Projects ───────────────────────────────────────────

export interface Project {
  id: string;
  ownerId: string;
  organizationId: string;
  name: string;
  description?: string | null;
  slug: string;
  status: ProjectStatus;
  thumbnailUrl?: string | null;
  modelProvider: string;
  modelName: string;
  createdAt: Date;
  updatedAt: Date;
  publishedAt?: Date | null;
}

// ─── Source Control ─────────────────────────────────────

export interface ProjectFile {
  id: string;
  projectId: string;
  path: string;
  content: string;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectSnapshot {
  id: string;
  projectId: string;
  versionNumber: number;
  manifest: Record<string, string>;
  sourceMessageId?: string | null;
  createdById?: string | null;
  message?: string | null;
  createdAt: Date;
}

export interface ProjectFileChange {
  id: string;
  snapshotId: string;
  path: string;
  operation: FileOperation;
  beforeHash?: string | null;
  afterHash?: string | null;
}

// ─── Chat Messages ──────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  result?: string;
}

export interface FileDiff {
  path: string;
  operation: 'create' | 'update' | 'delete';
  content?: string;
  oldContent?: string;
}

export interface ChatMessage {
  id: string;
  projectId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[] | null;
  filesModified?: FileDiff[] | null;
  model: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | null;
  thinking?: string | null;
}

// ─── Backend Functions ──────────────────────────────────

export interface BackendFunction {
  id: string;
  projectId: string;
  path: string;
  method: string;
  code: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Deployments ────────────────────────────────────────

export interface Deployment {
  id: string;
  projectId: string;
  snapshotId?: string | null;
  version: number;
  status: DeploymentStatus;
  url?: string | null;
  customDomain?: string | null;
  buildLogs?: string | null;
  e2bBuildId?: string | null;
  vercelProjectId?: string | null;
  vercelDeploymentId?: string | null;
  commitSha?: string | null;
  errorCode?: string | null;
  createdAt: Date;
  deployedAt?: Date | null;
}

// ─── Domains ────────────────────────────────────────────

export interface Domain {
  id: string;
  projectId: string;
  hostname: string;
  status: string;
  verification?: Record<string, unknown> | null;
  vercelDomainId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Templates ──────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  thumbnailUrl?: string | null;
  previewUrl?: string | null;
  repoUrl?: string | null;
  cloneCount: number;
  featured: boolean;
  createdAt?: Date;
}

// ─── Agents ─────────────────────────────────────────────

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  description?: string | null;
  modelProvider: string;
  modelName: string;
  schedule?: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AgentRun {
  id: string;
  agentId: string;
  status: string;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  errorCode?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
}

// ─── Infrastructure ─────────────────────────────────────

export interface BackgroundJob {
  id: string;
  type: string;
  status: JobStatus;
  organizationId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  idempotencyKey?: string | null;
  payload: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedAt?: Date | null;
  lastErrorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuditEvent {
  id: string;
  organizationId: string;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipHash?: string | null;
  createdAt: Date;
}

// ─── Billing & Entitlements ─────────────────────────────

export interface Subscription {
  id: string;
  organizationId: string;
  stripeCustomerId: string;
  stripeSubscriptionId?: string | null;
  priceId?: string | null;
  status: SubscriptionStatus;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Entitlement {
  id: string;
  organizationId: string;
  key: string;
  limit?: number | null;
  enabled: boolean;
  source: string;
  updatedAt: Date;
}

// ─── API Request/Response types ─────────────────────────

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  templateId: z.string().uuid().optional(),
  initialPrompt: z.string().max(10000).optional(),
  modelProvider: z.string(),
  modelName: z.string(),
  organizationId: z.string().uuid(),
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export const UpdateProjectInput = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  status: ProjectStatus.optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>;

export const CreateApiKeyInput = z.object({
  provider: AIProvider,
  key: z.string().min(1),
  label: z.string().max(100).optional(),
  baseUrl: z.string().url().optional().or(z.literal('')).transform((v) => (v === '' ? undefined : v)),
});
export type CreateApiKeyInput = z.infer<typeof CreateApiKeyInput>;

export const SendChatInput = z.object({
  projectId: z.string().uuid(),
  content: z.string().min(1).max(10000),
  modelProvider: z.string(),
  modelName: z.string(),
});
export type SendChatInput = z.infer<typeof SendChatInput>;

// ─── AI Gateway Types ───────────────────────────────────

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export type AIGatewayMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: AIToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface AICompletionRequest {
  provider: AIProvider;
  model: string;
  messages: AIGatewayMessage[];
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface AIStreamChunk {
  content: string;
  reasoning?: string;
  finishReason?: string;
  toolCalls?: AIToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AICompletionResponse {
  content: string;
  reasoning?: string;
  finishReason: string;
  toolCalls?: AIToolCall[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
