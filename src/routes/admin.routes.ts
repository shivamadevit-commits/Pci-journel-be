import * as c from '../controllers/admin.controller';
import * as v from '../validators/admin.validators';
import * as a from '../validators/article.validators';
import * as e from '../validators/editorial.validators';
import { publicRoute, route } from '../utils/route';

const ADMIN = ['ADMIN'] as const;
const EDITORIAL = ['ADMIN', 'EDITOR'] as const;
const t = 'Administration';

export const adminRoutes = [
  route({ method: 'get', path: '/admin/dashboard', tag: t, roles: [...ADMIN], summary: 'Admin dashboard counters', handler: c.dashboard }),

  route({ method: 'get', path: '/admin/users', tag: t, roles: [...ADMIN], summary: 'List / search users', query: v.listUsersQuery, handler: c.listUsers }),
  route({ method: 'post', path: '/admin/users', tag: t, roles: [...ADMIN], summary: 'Create an Editor / Production / Admin account (invitation e-mailed)', status: 201, body: v.createStaffBody, errors: [409], handler: c.createStaff }),
  route({ method: 'get', path: '/admin/users/:userId', tag: t, roles: [...ADMIN], summary: 'User detail', params: v.userIdParam, errors: [404], handler: c.getUser }),
  route({ method: 'put', path: '/admin/users/:userId/role', tag: t, roles: [...ADMIN], summary: 'Change a staff member’s role (sessions revoked)', params: v.userIdParam, body: v.changeRoleBody, errors: [403, 404, 409], handler: c.changeRole }),
  route({ method: 'put', path: '/admin/users/:userId/status', tag: t, roles: [...ADMIN], summary: 'Activate / deactivate / suspend an account', params: v.userIdParam, body: v.changeStatusBody, errors: [403, 404, 409], handler: c.changeStatus }),
  route({ method: 'post', path: '/admin/users/:userId/resend-invite', tag: t, roles: [...ADMIN], summary: 'Re-issue the account invitation', params: v.userIdParam, errors: [404, 409], handler: c.resendInvite }),

  route({ method: 'get', path: '/admin/editors', tag: t, roles: [...ADMIN], summary: 'Active editors (for editor assignment)', query: v.listUsersQuery, handler: c.listEditors }),
  route({ method: 'put', path: '/admin/articles/:articleId/editor', tag: t, roles: [...ADMIN], summary: 'Assign an editor to an article', params: a.articleIdParam, body: e.assignEditorBody, errors: [404, 409, 422], handler: c.assignEditor }),

  route({ method: 'get', path: '/admin/config', tag: t, roles: [...ADMIN], summary: 'Portal configuration (word limit, APC rules, revision policy…)', handler: c.getConfigHandler }),
  route({ method: 'put', path: '/admin/config', tag: t, roles: [...ADMIN], summary: 'Update portal configuration (audited)', body: v.updateConfigBody, handler: c.updateConfigHandler }),

  route({ method: 'get', path: '/admin/audit-logs', tag: t, roles: [...ADMIN], summary: 'Search the append-only audit trail', query: v.auditQuery, handler: c.listAudit }),

  route({ method: 'get', path: '/admin/subject-areas', tag: t, roles: [...ADMIN], summary: 'All subject areas including inactive', handler: c.listAllSubjectAreas }),
  route({ method: 'post', path: '/admin/subject-areas', tag: t, roles: [...ADMIN], summary: 'Create a subject area', status: 201, body: v.createSubjectAreaBody, errors: [409], handler: c.createSubjectArea }),
  route({ method: 'patch', path: '/admin/subject-areas/:subjectAreaId', tag: t, roles: [...ADMIN], summary: 'Rename / (de)activate a subject area', params: v.subjectAreaIdParam, body: v.updateSubjectAreaBody, errors: [404], handler: c.updateSubjectArea }),

  // Shared by all roles
  publicRoute({ method: 'get', path: '/subject-areas', tag: 'Reference data', summary: 'Active subject areas (public; needed by the reviewer application form)', handler: c.listSubjectAreas }),
  route({ method: 'patch', path: '/users/me/profile', tag: 'Profile', roles: 'any', summary: 'Update own profile (fields depend on role)', body: v.updateProfileBody, handler: c.updateMyProfile }),
  route({ method: 'get', path: '/notifications', tag: 'Notifications', roles: 'any', summary: 'My in-portal notifications (meta.unread = unread count)', query: v.notificationsQuery, handler: c.listNotifications }),
  route({ method: 'post', path: '/notifications/read-all', tag: 'Notifications', roles: 'any', summary: 'Mark all notifications as read', handler: c.markAllNotificationsRead }),
  route({ method: 'post', path: '/notifications/:notificationId/read', tag: 'Notifications', roles: 'any', summary: 'Mark a notification as read', params: v.notificationIdParam, errors: [404], handler: c.markNotificationRead }),
];

export { EDITORIAL };
