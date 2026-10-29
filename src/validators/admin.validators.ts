import { Role, UserStatus } from '@prisma/client';
import { z } from 'zod';
import { portalConfigSchema } from '../services/config.service';
import { email, idParam, isoDate, name, optionalText, search, uuid } from '../schemas/common';
import { paginationSchema, sortSchema } from '../utils/pagination';

export const listUsersQuery = paginationSchema.extend({
  search,
  role: z.enum(Role).optional(),
  status: z.enum(UserStatus).optional(),
  ...sortSchema(['createdAt', 'lastName', 'email', 'lastLoginAt'], 'createdAt').shape,
});

export const userIdParam = idParam('userId');

export const createStaffBody = z.object({
  email,
  firstName: name(),
  lastName: name(),
  role: z.enum(['CHIEF_EDITOR_ADMIN', 'EDITOR', 'PRODUCTION']),
  designation: optionalText(150),
});

export const changeRoleBody = z.object({ role: z.enum(['CHIEF_EDITOR_ADMIN', 'EDITOR', 'PRODUCTION']) });
export const changeStatusBody = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']) });

export const updateProfileBody = z
  .object({
    firstName: name().optional(),
    lastName: name().optional(),
    affiliation: optionalText(250),
    country: optionalText(100),
    phone: z.string().trim().max(30).regex(/^[+\d][\d\s().-]{4,29}$/, 'Invalid phone number').optional(),
    designation: optionalText(150),
    institution: optionalText(250),
    qualificationNotes: optionalText(2000),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' });

export const subjectAreaIdParam = idParam('subjectAreaId');
export const createSubjectAreaBody = z.object({ name: name(120) });
export const updateSubjectAreaBody = z
  .object({ name: name(120).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.name !== undefined || v.isActive !== undefined, { message: 'Provide at least one field to update' });

export const updateConfigBody = portalConfigSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one setting to update' });

export const auditQuery = paginationSchema.extend({
  actorId: uuid.optional(),
  action: z.string().trim().max(80).regex(/^[a-z_.]+$/, 'Invalid action filter').optional(),
  entityType: z.string().trim().max(60).regex(/^[A-Za-z]+$/).optional(),
  entityId: z.string().trim().max(64).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const notificationsQuery = paginationSchema.extend({
  unreadOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});
export const notificationIdParam = idParam('notificationId');
