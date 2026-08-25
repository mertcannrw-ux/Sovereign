import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma-generated/prisma/client';
import type { GeneratedFile } from '@/lib/generation-protocol';

export type DbClient = PrismaClient | Prisma.TransactionClient;

export async function persistProjectFiles(
  db: DbClient,
  projectId: string,
  files: GeneratedFile[],
): Promise<void> {
  for (const file of files) {
    const contentHash = createHash('sha256').update(file.content).digest('hex');
    await db.projectFile.upsert({
      where: { projectId_path: { projectId, path: file.path } },
      create: { projectId, path: file.path, content: file.content, contentHash },
      update: { content: file.content, contentHash },
    });
  }
}
