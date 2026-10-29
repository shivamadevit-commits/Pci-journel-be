import * as v from '../validators/admin.validators';
import * as article from '../validators/article.validators';
import * as editorialV from '../validators/editorial.validators';
import * as users from '../services/user.service';
import * as audit from '../services/audit.service';
import * as notifications from '../services/notification.service';
import * as dashboards from '../services/dashboard.service';
import * as editorial from '../services/editorial.service';
import { getConfig, updateConfig } from '../services/config.service';
import type { C } from '../utils/route';

export const listUsers = async ({ query }: C<undefined, typeof v.listUsersQuery>) => {
  const r = await users.listUsers(query);
  return { data: r.items, meta: r.meta };
};
export const getUser = async ({ params }: C<undefined, undefined, typeof v.userIdParam>) => ({ data: await users.getUser(params.userId) });
export const createStaff = async ({ user, body }: C<typeof v.createStaffBody>) => ({ status: 201, message: 'Account created and invitation issued', data: await users.createStaff(body, user) });
export const resendInvite = async ({ user, params }: C<undefined, undefined, typeof v.userIdParam>) => ({ message: 'Invitation re-issued', data: await users.resendInvite(params.userId, user) });
export const changeRole = async ({ user, params, body }: C<typeof v.changeRoleBody, undefined, typeof v.userIdParam>) => ({ message: 'Role updated', data: await users.changeRole(params.userId, body.role, user) });
export const changeStatus = async ({ user, params, body }: C<typeof v.changeStatusBody, undefined, typeof v.userIdParam>) => ({ message: 'Account status updated', data: await users.changeStatus(params.userId, body.status, user) });

export const listEditors = async ({ query }: C<undefined, typeof v.listUsersQuery>) => {
  const r = await users.listUsers({ ...query, role: 'EDITOR', status: 'ACTIVE' });
  return { data: r.items.map((u) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email })), meta: r.meta };
};

export const assignEditor = async ({ user, params, body }: C<typeof editorialV.assignEditorBody, undefined, typeof article.articleIdParam>) => ({
  message: 'Editor assigned',
  data: await editorial.assignEditor(params.articleId, body.editorId, user),
});

export const getConfigHandler = async () => ({ data: await getConfig() });
export const updateConfigHandler = async ({ user, body }: C<typeof v.updateConfigBody>) => ({ message: 'Configuration updated', data: await updateConfig(body, user) });

export const listAudit = async ({ query }: C<undefined, typeof v.auditQuery>) => {
  const r = await audit.listAudit(query);
  return { data: r.items, meta: r.meta };
};

export const dashboard = async () => ({ data: await dashboards.adminDashboard() });

export const createSubjectArea = async ({ user, body }: C<typeof v.createSubjectAreaBody>) => ({ status: 201, message: 'Subject area created', data: await users.createSubjectArea(body.name, user) });
export const updateSubjectArea = async ({ user, params, body }: C<typeof v.updateSubjectAreaBody, undefined, typeof v.subjectAreaIdParam>) => ({
  message: 'Subject area updated',
  data: await users.updateSubjectArea(params.subjectAreaId, body, user),
});
export const listSubjectAreas = async () => ({ data: await users.listSubjectAreas(false) });
export const listAllSubjectAreas = async () => ({ data: await users.listSubjectAreas(true) });

// own profile & notifications (any authenticated role)
export const updateMyProfile = async ({ user, body }: C<typeof v.updateProfileBody>) => ({ message: 'Profile updated', data: await users.updateMyProfile(user, body) });

export const listNotifications = async ({ user, query }: C<undefined, typeof v.notificationsQuery>) => {
  const r = await notifications.listNotifications(user.id, query);
  return { data: r.items, meta: r.meta };
};
export const markNotificationRead = async ({ user, params }: C<undefined, undefined, typeof v.notificationIdParam>) => {
  await notifications.markRead(user.id, params.notificationId);
  return { message: 'Marked as read' };
};
export const markAllNotificationsRead = async ({ user }: C) => {
  await notifications.markAllRead(user.id);
  return { message: 'All notifications marked as read' };
};
