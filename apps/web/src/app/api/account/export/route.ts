import { NextResponse } from 'next/server';
import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { checkRateLimit } from '@/server/rate-limit';
import { createZip, safeZipPath, type ZipEntry } from '@/server/zip';

const README = `Sovereign data export

account.json   Your profile, sign-in methods, preferences and teams.
settings.json  Your AI provider and image provider settings. API keys are never
               included: they stay encrypted on our side and are not exported.
projects/      One folder per project you own: project.json, chat.json and the
               project's source files under files/.
`;

const json = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Settings > Profile > "Export my data": a zip of everything the account holds,
 * built on request and downloaded directly.
 */
export async function GET() {
  const session = await getVerifiedSession();
  if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });
  const userId = session.user.id;

  const rate = await checkRateLimit('accountExport', userId);
  if (!rate.allowed) {
    return new NextResponse('Too many exports. Try again in an hour.', { status: 429 });
  }

  const db = getDb();
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      accounts: { select: { provider: true } },
      organizations: { include: { organization: { select: { name: true } } } },
      apiKeys: {
        select: { provider: true, label: true, baseUrl: true, createdAt: true, lastUsedAt: true },
      },
      imageProviderConfigs: {
        select: { label: true, baseUrl: true, model: true, enabled: true, createdAt: true },
      },
    },
  });
  if (!user) return new NextResponse('Unauthorized', { status: 401 });

  const projects = await db.project.findMany({
    where: { ownerId: userId },
    include: {
      files: { select: { path: true, content: true }, orderBy: { path: 'asc' } },
      messages: {
        select: { role: true, content: true, timestamp: true, model: true },
        orderBy: { timestamp: 'asc' },
      },
      deployments: {
        where: { status: 'LIVE' },
        select: { url: true, deployedAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  const entries: ZipEntry[] = [
    { path: 'README.txt', data: README },
    {
      path: 'account.json',
      data: json({
        id: user.id,
        email: user.email,
        pendingEmail: user.pendingEmail,
        name: user.name,
        createdAt: user.createdAt,
        signInMethods: {
          password: user.passwordHash !== null,
          providers: user.accounts.map((account) => account.provider),
        },
        preferences: { mascotAnimations: user.mascotAnimations },
        teams: user.organizations.map((m) => ({ name: m.organization.name, role: m.role })),
      }),
    },
    {
      path: 'settings.json',
      data: json({
        aiProviders: user.apiKeys,
        imageProviders: user.imageProviderConfigs,
      }),
    },
  ];

  if (user.avatarImage && user.avatarMime) {
    const ext = user.avatarMime.split('/')[1] === 'jpeg' ? 'jpg' : user.avatarMime.split('/')[1];
    entries.push({ path: `avatar.${ext}`, data: new Uint8Array(user.avatarImage) });
  }

  for (const project of projects) {
    // Slugs are unique, so folders never collide.
    const dir = `projects/${safeZipPath(project.slug) || project.id}`;
    entries.push({
      path: `${dir}/project.json`,
      data: json({
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        publishedAt: project.publishedAt,
        liveUrls: project.deployments.map((d) => d.url).filter(Boolean),
        model: { provider: project.modelProvider, name: project.modelName },
      }),
    });
    entries.push({ path: `${dir}/chat.json`, data: json(project.messages) });
    for (const file of project.files) {
      const path = safeZipPath(file.path);
      if (path) entries.push({ path: `${dir}/files/${path}`, data: file.content });
    }
  }

  const zip = createZip(entries);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="sovereign-export-${date}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const dynamic = 'force-dynamic';
