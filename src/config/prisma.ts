import { PrismaClient, Prisma } from '@prisma/client';
import { env } from './env';

export const prisma = new PrismaClient({
  log: env.isProd ? [{ level: 'error', emit: 'stdout' }] : [{ level: 'warn', emit: 'stdout' }, { level: 'error', emit: 'stdout' }],
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Prisma.TransactionClient;

export async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
