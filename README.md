# Sovereign

A bring-your-own-key (BYOK) AI app builder. Sovereign generates full-stack web applications from prompts, versions every change, and supports element-level editing in a live preview.

## Features

- **Code generation.** Generate, iterate on, and patch React and Next.js applications with the model of your choice.
- **Visual editing.** Inspect and modify elements directly in the live preview.
- **Realms.** Shared workspaces where people and the Sovereign agent build from the same context: members with Owner, Admin and Member roles, the Realm's provider keys, a brief, readable memory, project comments, an activity feed, and rules with approvals. See [docs/specs/realms.md](docs/specs/realms.md).
- **BYOK.** Provider API keys are encrypted at rest with AES-256-GCM.
- **Persistence.** PostgreSQL through Prisma.

## Repository

```
apps/web/              Next.js app: UI, tRPC API, server routes
packages/ai-gateway/   Provider interface, streaming, SSRF protection
packages/codegen/      Code generation, parsing, and patch protocol
packages/shared/       Shared types, schemas, and utilities
packages/ui/           Shared UI helpers
packages/visual-editor/ Element selection and property editing
packages/tsconfig/     Shared TypeScript configuration
prisma/                Schema, SQL, and seed script
docs/                  Technical documentation
```

Further reading:

- [`design.md`](./design.md): design system, tokens, and component conventions
- [`docs/agent-runtime.md`](./docs/agent-runtime.md): agent runtime, generation protocol, and tool contract

## Getting started

Requires Node.js 20+ and npm 10+.

```bash
npm install
cp .env.example apps/web/.env
```

Next.js reads env files from `apps/web`, not the repository root. `prisma.config.ts` loads the same file, so database scripts work from the root.

Start the local database, apply the migrations, and seed it:

```bash
npm run db:start   # PGlite server on 127.0.0.1:5433
npm run db:deploy  # in a second terminal
npm run db:seed
```

The seed creates an admin account from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `apps/web/.env`.

Run the app:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                   | Description                                      |
| :------------------------ | :----------------------------------------------- |
| `npm run dev`             | Start the development server on port 3000        |
| `npm run build`           | Build all apps and packages                      |
| `npm run test`            | Run unit tests in every workspace                |
| `npm run typecheck`       | Typecheck all workspaces                         |
| `npm run check`           | Typecheck, lint, and build                       |
| `npm run format`          | Format with Prettier                             |
| `npm run format:check`    | Check formatting (used by CI)                    |
| `npm run db:start`        | Start the local PGlite server                    |
| `npm run db:generate`     | Generate the Prisma client                       |
| `npm run db:migrate`      | Create and apply a migration (see below)         |
| `npm run db:deploy`       | Apply pending migrations                         |
| `npm run db:status`       | Show which migrations are applied                |
| `npm run db:seed`         | Seed the admin user and their personal Realm     |
| `npm run db:studio`       | Open Prisma Studio                               |
| `npm run interest:report` | List users who tried to subscribe to a paid plan |

End-to-end tests use Playwright and start the app automatically:

```bash
cd apps/web
npx playwright install chromium   # first run only
npm run test:e2e
```

## Database migrations

The schema lives in `prisma/schema.prisma`; every change to it ships as a migration in `prisma/migrations`. After editing the schema, with the local database running:

```bash
npm run db:migrate -- add_project_tags
```

This writes `prisma/migrations/<timestamp>_add_project_tags/migration.sql` and applies it locally. Review the SQL (renames show up as a drop plus an add, so edit those by hand) and commit it with the schema change. CI fails when `schema.prisma` and the migrations disagree.

(`prisma migrate dev` does not work here: it needs a shadow database, which the single-database PGlite server cannot provide.)

## Deployment

- Run `npm run db:deploy` against the production database before starting each new release. It applies pending migrations only and never resets data.
- A database created earlier with `prisma db push` already has the baseline schema. Mark it as applied once, instead of running it: `npx prisma migrate resolve --applied 0_init`.
- Set `TRUSTED_PROXY="true"` when running behind a reverse proxy. Otherwise every request appears to come from `127.0.0.1` and pre-auth rate limits share a single bucket.
- Health checks: `GET /api/health/live` (liveness) and `GET /api/health/ready` (readiness, includes the database).
- Use `.env.example` as the reference for all configuration. Never commit `.env` files.
