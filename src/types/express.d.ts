import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      email: string;
      role: Role;
      firstName: string;
      lastName: string;
      sessionId: string;
    }
    interface Request {
      requestId: string;
      user?: AuthUser;
      rawBody?: Buffer;
    }
  }
}

export {};
