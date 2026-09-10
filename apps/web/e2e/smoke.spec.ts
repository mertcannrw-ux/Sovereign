import { test, expect } from '@playwright/test';

/**
 * Smoke coverage for the invariants that must hold in every deploy: the app
 * boots, the database is reachable, security headers are applied, and
 * unauthenticated callers cannot reach protected API routes.
 */

test.describe('health', () => {
  test('liveness probe responds without dependencies', async ({ request }) => {
    const response = await request.get('/api/health/live');
    expect(response.status()).toBe(200);
    expect((await response.json()).status).toBe('ok');
  });

  test('readiness probe reaches the database', async ({ request }) => {
    const response = await request.get('/api/health/ready');
    const body = await response.json();
    expect(response.status(), `readiness checks: ${JSON.stringify(body.checks)}`).toBe(200);
    expect(body.status).toBe('ready');
  });
});

test.describe('security headers', () => {
  test('responses carry CSP and clickjacking protections', async ({ request }) => {
    const response = await request.get('/auth/signin');
    const headers = response.headers();

    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    // WebContainer workers need cross-origin isolation on every entry point.
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(headers['cross-origin-embedder-policy']).toBe('require-corp');
  });

  test('unauthenticated generation requests are rejected', async ({ request }) => {
    const response = await request.post('/api/generate', {
      data: { projectId: '00000000-0000-0000-0000-000000000000', message: 'hello' },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe('pages', () => {
  test('landing page renders', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('sign-in page exposes labelled credentials fields', async ({ page }) => {
    await page.goto('/auth/signin');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    await expect(page.getByLabel('Email address')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
  });
});
