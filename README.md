# Sovereign

A bring-your-own-key (BYOK) AI app builder. Sovereign generates full-stack web applications from prompts, versions every change, and supports element-level editing in a live preview.

## Features

- **Code generation.** Generate, iterate on, and patch React and Next.js applications with the model of your choice.
- **Visual editing.** Inspect and modify elements directly in the live preview.
- **Multi-tenancy.** Organizations, members, projects, and roles (Owner, Editor, Viewer).
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

Start the local database, apply the schema, and seed it:

```bash
npm run db:start   # PGlite server on 127.0.0.1:5433
npm run db:push
npm run db:seed    # in a second terminal
```

The seed creates an admin account from `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD` in `apps/web/.env`.

Run the app:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command                | Description                               |
| :--------------------- | :---------------------------------------- |
| `npm run dev`          | Start the development server on port 3000 |
| `npm run build`        | Build all apps and packages               |
| `npm run test`         | Run unit tests in every workspace         |
| `npm run typecheck`    | Typecheck all workspaces                  |
| `npm run check`        | Typecheck, lint, and build                |
| `npm run format`       | Format with Prettier                      |
| `npm run format:check` | Check formatting (used by CI)             |
| `npm run db:start`     | Start the local PGlite server             |
| `npm run db:generate`  | Generate the Prisma client                |
| `npm run db:push`      | Push the Prisma schema to the database    |
| `npm run db:seed`      | Seed the admin user and demo projects     |
| `npm run db:studio`    | Open Prisma Studio                        |

End-to-end tests use Playwright and start the app automatically:

```bash
cd apps/web
npx playwright install chromium   # first run only
npm run test:e2e
```

## Deployment

- Set `TRUSTED_PROXY="true"` when running behind a reverse proxy. Otherwise every request appears to come from `127.0.0.1` and pre-auth rate limits share a single bucket.
- Health checks: `GET /api/health/live` (liveness) and `GET /api/health/ready` (readiness, includes the database).
- Use `.env.example` as the reference for all configuration. Never commit `.env` files.
