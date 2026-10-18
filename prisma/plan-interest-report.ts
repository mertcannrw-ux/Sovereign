// `npm run interest:report`: who pressed a paid plan's subscribe button while
// paid plans were "coming soon". Each user counts once, however often they
// clicked. Reads DATABASE_URL like prisma.config.ts does.
import { config } from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

config({ path: ['apps/web/.env', '.env'], quiet: true });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const rows = await prisma.planInterest.findMany({
    orderBy: { createdAt: 'asc' },
    select: { plan: true, createdAt: true, user: { select: { email: true, name: true } } },
  });

  const byUser = new Map<string, { name: string | null; plans: string[]; first: Date }>();
  const byPlan = new Map<string, number>();
  for (const row of rows) {
    byPlan.set(row.plan, (byPlan.get(row.plan) ?? 0) + 1);
    const entry = byUser.get(row.user.email);
    if (entry) entry.plans.push(row.plan);
    else
      byUser.set(row.user.email, { name: row.user.name, plans: [row.plan], first: row.createdAt });
  }

  console.log(`Interested users: ${byUser.size}`);
  for (const [plan, count] of byPlan) console.log(`  ${plan}: ${count}`);
  if (byUser.size === 0) return;

  console.log('');
  console.table(
    [...byUser].map(([email, { name, plans, first }]) => ({
      email,
      name: name ?? '',
      plans: plans.join(', '),
      'first click': first.toISOString().slice(0, 10),
    })),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
