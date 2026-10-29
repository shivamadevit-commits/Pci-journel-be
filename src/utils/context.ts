import { AsyncLocalStorage } from 'node:async_hooks';
import type { Role } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma';

export interface Actor {
  id: string;
  role: Role;
}

interface RequestStore {
  requestId: string;
}

const requestStore = new AsyncLocalStorage<RequestStore>();
export const runWithRequest = <T>(requestId: string, fn: () => T): T => requestStore.run({ requestId }, fn);
export const currentRequestId = (): string | undefined => requestStore.getStore()?.requestId;

interface TxStore {
  hooks: Array<() => void>;
}
const txStore = new AsyncLocalStorage<TxStore>();

/** Runs a database transaction; hooks registered with afterCommit() run only if it commits. */
export async function transact<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const store: TxStore = { hooks: [] };
  const result = await txStore.run(store, () => prisma.$transaction(fn, { maxWait: 5000, timeout: 30000 }));
  for (const hook of store.hooks) {
    try {
      hook();
    } catch {
      /* post-commit side effects must never fail the request */
    }
  }
  return result;
}

export function afterCommit(fn: () => void): void {
  const store = txStore.getStore();
  if (store) store.hooks.push(fn);
  else fn();
}
