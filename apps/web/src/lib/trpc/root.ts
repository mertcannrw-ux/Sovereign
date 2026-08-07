import { router } from './trpc';
import { authRouter } from './routers/auth';
import { apiKeysRouter } from './routers/apiKeys';
import { projectsRouter } from './routers/projects';
import { chatRouter } from './routers/chat';
import { githubRouter } from './routers/github';
import { functionsRouter } from './routers/functions';
import { databaseRouter } from './routers/database';
import { appAuthRouter } from './routers/appAuth';
import { deploymentsRouter } from './routers/deployments';
import { organizationsRouter } from './routers/organizations';

export const appRouter = router({
  auth: authRouter,
  apiKeys: apiKeysRouter,
  projects: projectsRouter,
  chat: chatRouter,
  github: githubRouter,
  functions: functionsRouter,
  deployments: deploymentsRouter,
  database: databaseRouter,
  appAuth: appAuthRouter,
  organizations: organizationsRouter,
});

export type AppRouter = typeof appRouter;
