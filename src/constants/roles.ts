import { Role } from '@prisma/client';

export { Role };

export const ROLES = Object.values(Role) as Role[];

/** Roles with editorial authority (Chief Editor / Admin outranks Editor). */
export const EDITORIAL_ROLES: Role[] = [Role.CHIEF_EDITOR_ADMIN, Role.EDITOR];

export const isEditorial = (role: Role): boolean => EDITORIAL_ROLES.includes(role);

/** Roles an administrator may create through the staff-creation endpoint. Authors self-register; reviewers come via application. */
export const STAFF_CREATABLE_ROLES: Role[] = [Role.CHIEF_EDITOR_ADMIN, Role.EDITOR, Role.PRODUCTION];
