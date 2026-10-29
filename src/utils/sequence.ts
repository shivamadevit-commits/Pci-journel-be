import type { Tx } from '../config/prisma';

/** Atomic, gap-tolerant counter (single UPSERT; safe under concurrency). */
export async function nextSequence(tx: Tx, name: string): Promise<number> {
  const row = await tx.sequence.upsert({
    where: { name },
    create: { name, value: 1 },
    update: { value: { increment: 1 } },
  });
  return row.value;
}

export const padded = (n: number, width = 6) => String(n).padStart(width, '0');
