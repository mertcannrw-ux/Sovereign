import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma-generated/prisma/client';
import type { GeneratedFile } from '@/lib/generation-protocol';

export async function persistProjectFiles(
  db: PrismaClient,
  projectId: string,
  files: GeneratedFile[],
): Promise<void> {
  await db.$transaction(
    files.map((file) => {
      const contentHash = createHash('sha256').update(file.content).digest('hex');
      return db.projectFile.upsert({
        where: { projectId_path: { projectId, path: file.path } },
        create: { projectId, path: file.path, content: file.content, contentHash },
        update: { content: file.content, contentHash },
      });
    }),
  );
}
