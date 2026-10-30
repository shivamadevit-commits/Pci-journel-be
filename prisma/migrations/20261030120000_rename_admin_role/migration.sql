-- The single administrator role is now simply "Admin" (was CHIEF_EDITOR_ADMIN); existing users keep the role.
ALTER TYPE "Role" RENAME VALUE 'CHIEF_EDITOR_ADMIN' TO 'ADMIN';
