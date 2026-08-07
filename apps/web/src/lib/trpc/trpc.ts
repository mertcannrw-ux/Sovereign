import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import type { Context } from './context';
import { ERROR_MESSAGES, ErrorCode, mapErrorCode } from '@/server/errors';

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const publicCode = mapErrorCode(error);
    const publicMessage = ERROR_MESSAGES[publicCode] ?? ERROR_MESSAGES[ErrorCode.INTERNAL_ERROR];

    return {
      ...shape,
      message:
        publicCode === ErrorCode.INTERNAL_ERROR ? publicMessage : (error.message ?? publicMessage),
      data: {
        ...shape.data,
        code: publicCode,
      },
    };
  },
});

/**
 * Base router builder.
 */
export const router = t.router;

/**
 * Public procedure — accessible without authentication.
 */
export const publicProcedure = t.procedure;

/**
 * Protected procedure — requires a valid session.
 * Throws UNAUTHORIZED when the caller is not logged in.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.session.user,
    },
  });
});
