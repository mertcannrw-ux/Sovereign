/**
 * Vercel Deployment Service
 *
 * Manages Vercel projects, deployments, and custom domains through
 * the Vercel REST API. Used by the background deployment pipeline to
 * replace the current simulated deployments.
 *
 * ─── Webhook Verification ─────────────────────────────────
 *
 * Vercel sends webhooks for deployment lifecycle events (ready, error,
 * canceled, checking, building).  To verify webhook authenticity:
 *
 *   1. In your Vercel project settings, add a webhook endpoint pointing to
 *      your platform (e.g. `/api/webhooks/vercel`) and note the secret.
 *   2. Store the secret as `VERCEL_WEBHOOK_SECRET` (add it to `env.ts`).
 *   3. Verify every incoming webhook:
 *
 *        import crypto from 'node:crypto';
 *
 *        const signature = request.headers.get('x-vercel-signature');
 *        if (!signature) {
 *          // respond 401
 *        }
 *
 *        const body = await request.text();
 *        const expected = crypto
 *          .createHmac('sha1', VERCEL_WEBHOOK_SECRET)
 *          .update(body)
 *          .digest('hex');
 *
 *        if (signature !== `sha1=${expected}`) {
 *          // respond 401 — payload was tampered or misrouted
 *        }
 *
 *   4. On successful verification, map Vercel's deployment status into
 *      your Deployment model:
 *
 *        | Vercel      | DeploymentStatus |
 *        |-------------|------------------|
 *        | BUILDING    | BUILDING         |
 *        | ERROR       | FAILED           |
 *        | READY       | LIVE             |
 *        | CANCELED    | CANCELED         |
 *
 *      Update the Deployment record with the matching status and, when
 *      READY, copy the `url` from the webhook payload.
 */

import { env } from '@/env';

// ─── Constants ─────────────────────────────────────────────

const VERCEL_API_BASE = 'https://api.vercel.com';

// ─── Types ────────────────────────────────────────────────

export interface CreateVercelProjectParams {
  /** Human-readable project name (shown in Vercel dashboard). */
  name: string;
  /** Framework slug recognized by Vercel (e.g. "vite", "nextjs"). */
  framework: string;
}

export interface CreateVercelProjectResult {
  /** Vercel's project ID (used in subsequent deploy & domain calls). */
  projectId: string;
}

export interface DeployToVercelParams {
  /** Vercel project ID (from createVercelProject or existing project). */
  projectId: string;
  /**
   * Source files to deploy.  Each entry is a file path and its content.
   * Text content should be passed as a UTF-8 string; binary content
   * should be base64-encoded.  For large projects prefer the Vercel
   * file-upload API and pass only the file manifest here.
   */
  files: { file: string; data: string }[];
}

export interface DeployToVercelResult {
  /** Vercel deployment ID (used in status checks and webhooks). */
  deploymentId: string;
  /** Production-like URL where the deployment is accessible. */
  url: string;
}

export interface DeploymentStatusResult {
  /**
   * One of: "BUILDING", "ERROR", "READY", "CANCELED", "QUEUED".
   * Vercel's raw status is returned; map it in the caller if needed.
   */
  status: string;
  /** Deployment URL — present once the deployment reaches READY. */
  url?: string;
}

export interface AddDomainParams {
  /** Vercel project ID. */
  projectId: string;
  /** Custom hostname to add (e.g. "app.example.com"). */
  hostname: string;
}

export interface AddDomainResult {
  /** Vercel domain record ID. */
  domainId: string;
}

// ─── Error ────────────────────────────────────────────────

export class VercelApiError extends Error {
  public readonly status: number;
  public readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'VercelApiError';
    this.status = status;
    this.code = code;
  }
}

// ─── Internal helpers ─────────────────────────────────────

/**
 * Build the common request headers for Vercel API calls.
 * Throws VercelApiError when VERL_TOKEN is not configured.
 */
function vercelHeaders(): Record<string, string> {
  const token = env.VERCEL_TOKEN;
  if (!token) {
    throw new VercelApiError(
      'VERCEL_TOKEN is not configured. Set VERCEL_TOKEN in your environment.',
      0,
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Make a typed request to the Vercel REST API.
 * Automatically appends `?teamId=` when VERCEL_ORG_ID is set.
 */
async function vercelFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers = vercelHeaders();

  let url = `${VERCEL_API_BASE}${path}`;
  if (env.VERCEL_ORG_ID) {
    const separator = path.includes('?') ? '&' : '?';
    url += `${separator}teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message =
      errorBody?.error?.message ??
      errorBody?.message ??
      `Vercel API responded with ${response.status} ${response.statusText}`;
    const code = errorBody?.error?.code;
    throw new VercelApiError(message, response.status, code);
  }

  return (await response.json()) as T;
}

// ─── Public API ───────────────────────────────────────────

/**
 * Create a new project on Vercel.
 *
 * The project is created under the team identified by VERCEL_ORG_ID
 * (or the user's personal account if unset).
 */
export async function createVercelProject(
  params: CreateVercelProjectParams,
): Promise<CreateVercelProjectResult> {
  const data = await vercelFetch<{ id: string; name: string }>('POST', '/v10/projects', {
    name: params.name,
    framework: params.framework,
  });
  return { projectId: data.id };
}

/**
 * Deploy source files to an existing Vercel project.
 *
 * Creates a new deployment — Vercel will build and deploy the
 * provided files according to the project's framework configuration.
 */
export async function deployToVercel(params: DeployToVercelParams): Promise<DeployToVercelResult> {
  const data = await vercelFetch<{ id: string; url: string; status: string }>(
    'POST',
    '/v13/deployments',
    {
      name: params.projectId,
      project: params.projectId,
      files: params.files,
    },
  );
  return { deploymentId: data.id, url: data.url };
}

/**
 * Query the current status of a deployment.
 *
 * Once the status is "READY", the `url` field contains the production
 * URL.  Callers should poll this endpoint (with back-off) or, preferably,
 * listen for Vercel webhooks to receive status transitions asynchronously.
 */
export async function getDeploymentStatus(deploymentId: string): Promise<DeploymentStatusResult> {
  const data = await vercelFetch<{ status: string; url?: string }>(
    'GET',
    `/v13/deployments/${encodeURIComponent(deploymentId)}`,
  );
  return { status: data.status, url: data.url };
}

/**
 * Add a custom domain to a Vercel project.
 *
 * After adding, Vercel will provide the DNS target records needed to
 * prove ownership.  The domain does not become active until the DNS
 * configuration is verified.
 */
export async function addDomain(params: AddDomainParams): Promise<AddDomainResult> {
  const data = await vercelFetch<{ id: string; name: string; verified: boolean }>(
    'POST',
    `/v9/projects/${encodeURIComponent(params.projectId)}/domains`,
    { name: params.hostname },
  );
  return { domainId: data.id };
}
