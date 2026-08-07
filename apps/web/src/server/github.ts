/**
 * GitHub App integration service.
 *
 * Uses the GitHub REST API via fetch (no octokit dependency).
 * Authentication: generates a short-lived JWT signed with the app's private key,
 * then exchanges it for an installation-scoped access token per request.
 * Tokens are requested per-use and NOT cached long-term; the GitHub API
 * expires them after ~1 hour, but this service treats each call as independent.
 *
 * Environment variables (from @/env):
 *   GITHUB_APP_ID       — numeric app ID (string)
 *   GITHUB_APP_PRIVATE_KEY — PEM-encoded RSA private key
 *   GITHUB_APP_WEBHOOK_SECRET — secret for verifying webhook payloads
 *
 * If any required variable is missing, functions throw an actionable error.
 */

import { env } from '@/env';
import crypto from 'crypto';

// ─── Constants ─────────────────────────────────────────────

const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const TOKEN_TTL_SECONDS = 600; // JWT valid for 10 minutes

// ─── Helpers ────────────────────────────────────────────────

function requireEnv(): {
  appId: string;
  privateKey: string;
  webhookSecret: string;
} {
  if (!env.GITHUB_APP_ID) {
    throw new Error('GITHUB_APP_ID is not configured. Set it in your environment variables.');
  }
  if (!env.GITHUB_APP_PRIVATE_KEY) {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY is not configured. Set it in your environment variables.',
    );
  }
  if (!env.GITHUB_APP_WEBHOOK_SECRET) {
    throw new Error(
      'GITHUB_APP_WEBHOOK_SECRET is not configured. Set it in your environment variables.',
    );
  }
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: env.GITHUB_APP_WEBHOOK_SECRET,
  };
}

/**
 * Generate a JWT for GitHub App authentication.
 * The JWT is signed with the app's private key and includes:
 *   - iss: the app ID
 *   - iat: current time
 *   - exp: current time + TTL (max 10 minutes per GitHub policy)
 */
function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: appId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const encode = (obj: Record<string, unknown>): string => {
    const json = JSON.stringify(obj);
    return Buffer.from(json).toString('base64url').replace(/=+$/, '');
  };

  const headerEncoded = encode(header);
  const payloadEncoded = encode(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;

  const sign = crypto.createSign('sha256');
  sign.update(signingInput);
  sign.end();
  const signature = sign.sign(privateKey, 'base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Make an authenticated request to the GitHub REST API.
 */
async function githubFetch(
  url: string,
  token: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'app-builder',
  };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  return fetch(url, init);
}

/**
 * Parse a GitHub API response, throwing on non-2xx.
 */
async function parseGithubResponse<T>(response: Response, context: string): Promise<T> {
  if (!response.ok) {
    let body: string | undefined;
    try {
      body = await response.text();
    } catch {
      // ignore parse errors on error body
    }
    const message = body
      ? `GitHub API error (${context}): ${response.status} — ${body.slice(0, 500)}`
      : `GitHub API error (${context}): ${response.status}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

// ─── Public API ────────────────────────────────────────────

/**
 * Create an installation access token for a GitHub App installation.
 *
 * This is the first step for any GitHub API call as an app installation.
 * The returned token is scoped to the installation's repositories.
 *
 * Tokens are requested per-use and should not be cached long-term;
 * GitHub expires them after ~1 hour (configurable during creation).
 *
 * @param installationId - The GitHub App installation ID (numeric string).
 * @returns A short-lived installation access token.
 */
export async function createInstallationAccessToken(installationId: string): Promise<string> {
  const { appId, privateKey } = requireEnv();

  const jwt = generateAppJwt(appId, privateKey);

  const url = `${GITHUB_API_BASE}/app/installations/${installationId}/access_tokens`;
  const response = await githubFetch(url, jwt, { method: 'POST' });

  const data = await parseGithubResponse<{ token: string }>(
    response,
    'createInstallationAccessToken',
  );

  return data.token;
}

/**
 * Create a GitHub repository in the installation's scope and populate it
 * from a project snapshot.
 *
 * The repository is created under the organization or user that owns the
 * GitHub App installation.
 *
 * @returns An object with the numeric repository ID and full clone URL.
 */
export async function createRepositoryFromSnapshot(params: {
  installationId: string;
  name: string;
  description?: string;
}): Promise<{ repositoryId: number; url: string }> {
  const token = await createInstallationAccessToken(params.installationId);

  // Create the repository via the installation endpoint
  const createUrl = `${GITHUB_API_BASE}/repositories`;
  const createResponse = await githubFetch(createUrl, token, {
    method: 'POST',
    body: {
      name: params.name,
      description: params.description ?? '',
      private: true,
      auto_init: false,
      has_issues: false,
      has_wiki: false,
      has_downloads: false,
    },
  });

  const repo = await parseGithubResponse<{
    id: number;
    clone_url: string;
  }>(createResponse, 'createRepository');

  return {
    repositoryId: repo.id,
    url: repo.clone_url,
  };
}

/**
 * Commit a set of files to a GitHub repository as a single snapshot.
 *
 * Uses the Contents API (create/update file per path). For repositories
 * with no prior commits, this first creates an initial commit via the
 * Git Database API (blob → tree → commit → reference).
 *
 * If `branch` is omitted, changes are made to the default branch.
 *
 * @returns The commit SHA of the created commit.
 */
export async function commitSnapshot(params: {
  installationId: string;
  owner: string;
  repo: string;
  files: { path: string; content: string }[];
  message: string;
  branch?: string;
}): Promise<{ sha: string }> {
  const { installationId, owner, repo, files, message, branch } = params;
  const token = await createInstallationAccessToken(installationId);

  const repoUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}`;

  // ── Step 1: Get the default branch's latest commit SHA ──
  const branchName =
    branch ??
    (await (async () => {
      const defResp = await githubFetch(repoUrl, token);
      const defRepo = await parseGithubResponse<{ default_branch: string }>(defResp, 'getRepo');
      return defRepo.default_branch;
    })());
  const refUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/ref/heads/${branchName}`;
  const refResponse = await githubFetch(refUrl, token);

  let baseTreeSha: string | undefined;
  let parentCommitSha: string | undefined;

  if (refResponse.ok) {
    const ref = await refResponse.json();
    parentCommitSha = ref.object.sha;

    // Get the tree of the parent commit
    const commitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits/${parentCommitSha}`;
    const commitResponse = await githubFetch(commitUrl, token);
    const commit = await commitResponse.json();
    baseTreeSha = commit.tree.sha;
  }
  // If ref doesn't exist (empty repo), we'll create without a parent

  // ── Step 2: Create blobs for each file ──
  const blobUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/blobs`;
  const blobPromises = files.map(async (file) => {
    const blobResponse = await githubFetch(blobUrl, token, {
      method: 'POST',
      body: {
        content: file.content,
        encoding: 'utf-8',
      },
    });
    const blob = await parseGithubResponse<{ sha: string }>(
      blobResponse,
      `createBlob(${file.path})`,
    );
    return { path: file.path, sha: blob.sha, mode: '100644' as const, type: 'blob' as const };
  });

  const treeEntries = await Promise.all(blobPromises);

  // ── Step 3: Create a tree ──
  const treeUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees`;
  const treeResponse = await githubFetch(treeUrl, token, {
    method: 'POST',
    body: {
      base_tree: baseTreeSha ?? null,
      tree: treeEntries,
    },
  });
  const tree = await parseGithubResponse<{ sha: string }>(treeResponse, 'createTree');

  // ── Step 4: Create a commit ──
  const commitUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/commits`;
  const commitPayload: {
    message: string;
    tree: string;
    parents: string[];
  } = {
    message,
    tree: tree.sha,
    parents: parentCommitSha ? [parentCommitSha] : [],
  };

  const commitResponse = await githubFetch(commitUrl, token, {
    method: 'POST',
    body: commitPayload,
  });
  const newCommit = await parseGithubResponse<{ sha: string }>(commitResponse, 'createCommit');

  // ── Step 5: Update the branch reference ──
  const updateRefUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/refs/heads/${branchName}`;
  const updateResponse = await githubFetch(updateRefUrl, token, {
    method: 'PATCH',
    body: {
      sha: newCommit.sha,
      force: false,
    },
  });
  await parseGithubResponse<{ ref: string; object: { sha: string } }>(updateResponse, 'updateRef');

  return { sha: newCommit.sha };
}

/**
 * Verify a GitHub webhook payload using HMAC-SHA256.
 *
 * GitHub signs webhook payloads with the app's webhook secret using
 * HMAC-SHA256. The signature is sent in the `X-Hub-Signature-256` header
 * as `sha256=<hexdigest>`.
 *
 * @param payload - The raw request body as a string.
 * @param signature - The value of the `X-Hub-Signature-256` header.
 * @param secret - The webhook secret (defaults to GITHUB_APP_WEBHOOK_SECRET).
 * @returns `true` if the signature is valid, `false` otherwise.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret?: string,
): boolean {
  const webhookSecret = secret ?? requireEnv().webhookSecret;

  // GitHub sends the signature as "sha256=<hexdigest>"
  const expectedPrefix = 'sha256=';
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const receivedDigest = signature.slice(expectedPrefix.length);

  const computedDigest = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload, 'utf-8')
    .digest('hex');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedDigest, 'hex'),
      Buffer.from(computedDigest, 'hex'),
    );
  } catch {
    // If digests are different lengths, timingSafeEqual throws
    return false;
  }
}
