import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      /** Mirrors User.sessionVersion; a mismatch with the DB invalidates the session. */
      sessionVersion?: number;
    } & DefaultSession['user'];
  }

  interface User {
    sessionVersion?: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionVersion?: number;
  }
}
