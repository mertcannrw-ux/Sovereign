import { router } from './trpc';
import { authRouter } from './routers/auth';
import { accountRouter } from './routers/account';
import { apiKeysRouter } from './routers/apiKeys';
import { projectsRouter } from './routers/projects';
import { chatRouter } from './routers/chat';
import { githubRouter } from './routers/github';
import { functionsRouter } from './routers/functions';
import { databaseRouter } from './routers/database';
import { appAuthRouter } from './routers/appAuth';
import { deploymentsRouter } from './routers/deployments';
import { realmsRouter } from './routers/realms';
import { assetsRouter } from './routers/assets';
import { imageProviderRouter } from './routers/imageProvider';
import { designDirectionsRouter } from './routers/designDirections';
import { billingRouter } from './routers/billing';

export const appRouter = router({
  auth: authRouter,
  account: accountRouter,
  apiKeys: apiKeysRouter,
  projects: projectsRouter,
  chat: chatRouter,
  github: githubRouter,
  functions: functionsRouter,
  deployments: deploymentsRouter,
  database: databaseRouter,
  appAuth: appAuthRouter,
  realms: realmsRouter,
  assets: assetsRouter,
  imageProvider: imageProviderRouter,
  designDirections: designDirectionsRouter,
  billing: billingRouter,
});

export type AppRouter = typeof appRouter;
