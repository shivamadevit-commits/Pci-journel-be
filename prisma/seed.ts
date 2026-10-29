/**
 * Idempotent seed: BRD subject areas + the first Chief Editor / Admin account.
 * Safe to run repeatedly; it never modifies existing users. Run with `npm run seed`.
 */
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const SUBJECT_AREAS = [
  'Pharmaceutics',
  'Pharmacology',
  'Clinical Pharmacy',
  'Pharmaceutical Chemistry',
  'Pharmacy Education',
  'Pharmacognosy',
  'Pharmacovigilance',
  'Pharmacy Practice',
  'Drug Delivery',
  'Clinical Pharmacology',
  'Biopharmaceutics',
  'Public Health Pharmacy',
];

async function main() {
  const prisma = new PrismaClient();
  try {
    for (const name of SUBJECT_AREAS) {
      await prisma.subjectArea.upsert({ where: { name }, create: { name }, update: {} });
    }

    const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
      console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: skipping admin creation.');
      return;
    }
    if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.log(`Admin ${email} already exists; left unchanged.`);
      return;
    }
    const cost = Number(process.env.BCRYPT_COST ?? 12);
    const user = await prisma.user.create({
      data: {
        email,
        firstName: process.env.SEED_ADMIN_FIRST_NAME ?? 'Chief',
        lastName: process.env.SEED_ADMIN_LAST_NAME ?? 'Editor',
        role: 'CHIEF_EDITOR_ADMIN',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        passwordChangedAt: new Date(),
        passwordHash: await bcrypt.hash(password, cost),
        editorProfile: { create: { designation: 'Chief Editor' } },
      },
    });
    await prisma.auditLog.create({ data: { action: 'user.created', entityType: 'User', entityId: user.id, actorRole: 'CHIEF_EDITOR_ADMIN', metadata: { source: 'seed' } } });
    console.log(`Created Chief Editor / Admin ${email}. Change the password after first sign-in.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
