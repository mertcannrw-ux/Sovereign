// Prisma seed script — creates initial admin account, personal organization, and demo data
import {
  PrismaClient,
  ProjectStatus,
  OrganizationRole,
  ProjectRole,
} from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding database...');

  // Refuse to run in production so an automated pipeline that copies the
  // .env.example placeholder credentials can never provision a known-password
  // admin. Seeds are for development/staging only.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed in production. Seeds are for development/staging only.');
  }

  // ── Admin user ──────────────────────────────────
  // Credentials come from the environment: refusing to seed a hardcoded
  // password (or run at all outside development) keeps the default-credential
  // footgun out of production.
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword || adminPassword.length < 12) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) must be set when seeding');
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });

  let adminId: string;

  if (existingUser) {
    console.log(`  ⏭  Admin user already exists: ${adminEmail}`);
    adminId = existingUser.id;
  } else {
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    const user = await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Admin',
        passwordHash,
        emailVerified: true,
      },
    });
    adminId = user.id;

    console.log(`  ✅ Admin user created (credentials from environment):`);
    console.log(`     User ID:  ${user.id}`);
  }

  // ── Personal organization ───────────────────────
  const orgSlug = 'admin-personal';
  let org = await prisma.organization.findUnique({ where: { slug: orgSlug } });

  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: "Admin's Organization",
        slug: orgSlug,
        ownerId: adminId,
        members: {
          create: {
            userId: adminId,
            role: OrganizationRole.OWNER,
          },
        },
      },
    });
    console.log(`  ✅ Organization created: ${org.name} (${org.id})`);
  } else {
    console.log(`  ⏭  Organization already exists: ${org.name}`);
  }

  // ── Demo projects ───────────────────────────────
  const existingProjects = await prisma.project.count({
    where: { ownerId: adminId },
  });

  if (existingProjects === 0) {
    await prisma.project.createMany({
      data: [
        {
          ownerId: adminId,
          organizationId: org.id,
          name: 'Todo App',
          description: 'A full-stack todo application with drag-and-drop',
          slug: 'todo-app',
          status: ProjectStatus.PUBLISHED,
        },
        {
          ownerId: adminId,
          organizationId: org.id,
          name: 'Blog Platform',
          description: 'Multi-author blog with markdown support',
          slug: 'blog-platform',
          status: ProjectStatus.DRAFT,
        },
        {
          ownerId: adminId,
          organizationId: org.id,
          name: 'Analytics Dashboard',
          description: 'Real-time analytics dashboard with charts',
          slug: 'analytics-dashboard',
          status: ProjectStatus.DRAFT,
        },
      ],
    });
    console.log('  ✅ 3 demo projects created');
  } else {
    console.log(`  ⏭  ${existingProjects} projects already exist, skipping demo data`);
  }

  console.log('✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
