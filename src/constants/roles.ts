import { Role } from '@prisma/client';

export { Role };

export const ROLES = Object.values(Role) as Role[];

/** Roles with editorial authority (Admin outranks Editor). */
export const EDITORIAL_ROLES: Role[] = [Role.ADMIN, Role.EDITOR];

export const isEditorial = (role: Role): boolean => EDITORIAL_ROLES.includes(role);

/** Roles the Admin may create through the staff-creation endpoint. There is exactly one Admin (seeded); Authors self-register; reviewers come via application. */
export const STAFF_CREATABLE_ROLES: Role[] = [Role.EDITOR, Role.PRODUCTION];
