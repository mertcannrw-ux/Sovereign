# Sovereign — AI App Builder

> **Sovereign** is a premium, editorial-grade Bring-Your-Own-Key (BYOK) AI SaaS application builder. It architects full-stack web applications, manages project versions, and enables live element-level visual canvas editing.

---

## ⚡ Key Features

- **AI Code Generation Engine:** Generate, iterate, and patch full-stack Next.js and React applications using AI models.
- **Visual Canvas & Element Editor:** Inspect and modify elements directly in the live browser preview.
- **Multi-Tenant Architecture:** Built-in support for Organizations, Members, Projects, and Access Roles (Owner, Editor, Viewer).
- **BYOK (Bring Your Own Key):** Securely store and encrypt provider API keys locally per workspace using AES-256-GCM.
- **Database & Persistence:** Powered by Prisma ORM and PostgreSQL with automatic schema generation and seed management.
- **Monorepo Architecture:** Clean sub-package decomposition using Turborepo.

---

## 🏗️ Project Structure

```
Sovereign/
├── apps/
│   └── web/                # Next.js App Router frontend, tRPC APIs, & server routes
├── packages/
│   ├── ai-gateway/         # AI provider interface, SSRF protection & streaming
│   ├── codegen/            # Code generation, parser, and patch protocol engine
│   ├── shared/             # Shared TypeScript types, schemas, & utilities
│   ├── tsconfig/           # Centralized TypeScript configurations
│   ├── ui/                 # Reusable UI component library (Tailwind CSS)
│   └── visual-editor/      # Visual element editor, selector engine & property panels
├── prisma/
│   ├── schema.prisma       # Database models & enums
│   ├── init.sql            # Full PostgreSQL DDL script
│   └── seed.ts             # Seed script for initial admin user & demo projects
└── README.md
```

---

## 📚 Documentation

| Document                                                                       | What it covers                                                                        |
| :----------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| [`design.md`](./design.md)                                                     | Design system: colour tokens, typography, spacing, component conventions, open issues |
| [`docs/design-accessibility-review.md`](./docs/design-accessibility-review.md) | Measured WCAG audit of the design system and app surfaces                             |
| [`docs/agent-runtime.md`](./docs/agent-runtime.md)                             | Agent runtime, generation protocol, and tool contract                                 |

---

## 🚀 Quick Start

### 1. Prerequisites

Ensure you have the following installed on your machine:

- **Node.js:** `v20.0.0` or higher
- **npm:** `v10.0.0` or higher

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

Copy the `.env.example` file into the app directory as `apps/web/.env`. Next.js resolves env files from the app directory, not the monorepo root, so `.env` only works when it lives next to `apps/web`:

```bash
cp .env.example apps/web/.env
```

On Windows PowerShell use `Copy-Item .env.example apps/web/.env`.

_(Note: The default `apps/web/.env` is configured for local development using the embedded PostgreSQL socket server. `prisma.config.ts` loads the same file, so `npm run db:push`, `db:seed`, and `db:studio` work from the repository root.)_

> **Production — rate limiting:** when deployed behind a reverse proxy (Vercel, Cloudflare, Nginx, …), set `TRUSTED_PROXY="true"`. Without it the app sees every request as `127.0.0.1`, so pre-auth rate limits (`register`/`signIn`) collapse into a single global bucket shared by all users. See `.env.example`.

---

## 🗄️ Database Setup & Development

### 1. Start the Local PostgreSQL Database

Launch the embedded PGLite server:

```bash
npm run db:start
```

_This starts a PostgreSQL server on `127.0.0.1:5433` using `.pglite_data`._

### 2. Push the Prisma Schema

Apply the schema to the running database:

```bash
npm run db:push
```

### 3. Seed Initial Admin & Demo Data

In a separate terminal window, populate the database:

```bash
npm run db:seed
```

#### 🔑 Local Admin Credentials (from `apps/web/.env`)

| Field            | Credential                                                                      |
| :--------------- | :------------------------------------------------------------------------------ |
| **Sign-in URL**  | [http://localhost:3000/auth/signin](http://localhost:3000/auth/signin)          |
| **Email**        | Set by `SEED_ADMIN_EMAIL` in `apps/web/.env` (default `admin@appbuilder.local`) |
| **Password**     | Set by `SEED_ADMIN_PASSWORD` in `apps/web/.env`                                 |
| **Organization** | `Admin's Organization`                                                          |

---

## 💻 Running the Application

Start the local development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📜 Available Scripts

| Command                | Description                                                      |
| :--------------------- | :--------------------------------------------------------------- |
| `npm run dev`          | Starts the Next.js development server on port 3000 via Turborepo |
| `npm run build`        | Builds all applications and packages for production              |
| `npm run db:start`     | Launches the local PGLite PostgreSQL server on port 5433         |
| `npm run db:generate`  | Generates the Prisma Client types                                |
| `npm run db:push`      | Pushes the Prisma schema directly to the database                |
| `npm run db:seed`      | Seeds initial admin user, organization, and demo projects        |
| `npm run db:studio`    | Opens Prisma Studio GUI to view and edit database rows           |
| `npm run format`       | Formats all files across the monorepo with Prettier              |
| `npm run format:check` | Verifies formatting without writing (used by CI)                 |
| `npm run test`         | Runs every workspace's unit test suite via Turborepo             |
| `npm run typecheck`    | Typechecks all workspaces                                        |
| `npm run check`        | Runs typechecking, linting, and build checks                     |

### End-to-end tests

Playwright smoke tests live in `apps/web/e2e` and cover health endpoints,
security headers, unauthenticated-API rejection, and page rendering:

```bash
cd apps/web
npx playwright install chromium   # first run only
npm run test:e2e
```

The Playwright config starts the app automatically (dev server locally,
`next start` in CI).

---

## 🩺 Health Check Endpoints

- **Readiness Probe:** `GET /api/health/ready` — Verifies database connection and critical services (`200 OK` when ready).
- **Liveness Probe:** `GET /api/health/live` — Basic server responsiveness probe (`200 OK`).

---

## 🔒 Security & Environment Protection

All sensitive environment files (`apps/web/.env`, `.env.local`), database data directories (`.pglite_data/`), and build artifacts are strictly ignored in `.gitignore` to prevent credential exposure. Always use `.env.example` as a template for production deployment configs.
