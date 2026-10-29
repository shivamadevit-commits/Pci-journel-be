import bcrypt from 'bcryptjs';
import { env } from '../config/env';

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, env.BCRYPT_COST);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

// Compared against when the account does not exist so response time does not reveal account existence.
const dummyHashPromise = bcrypt.hash('dummy-password-for-timing-equalisation', env.BCRYPT_COST);
export async function burnPasswordCheck(plain: string): Promise<void> {
  await bcrypt.compare(plain, await dummyHashPromise);
}
