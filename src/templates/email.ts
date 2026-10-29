import { env } from '../config/env';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Spec {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** Shown highlighted (e.g. an OTP). */
  code?: string;
}

type D = Record<string, string | number | undefined | null>;
const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

// Content only — no business logic. Reviewer-facing templates never receive author data and author-facing
// templates never receive reviewer data (double-blind), so nothing here can leak identities.
const templates: Record<string, (d: D) => Spec> = {
  verification_otp: (d) => ({
    subject: 'Verify your email address',
    heading: 'Verify your email',
    paragraphs: [`Hello ${s(d.name)},`, `Use the code below to verify your email address. It expires in ${s(d.minutes)} minutes.`, 'If you did not create an account, you can ignore this email.'],
    code: s(d.otp),
  }),
  login_otp: (d) => ({
    subject: 'Your sign-in code',
    heading: 'Sign-in verification',
    paragraphs: [`Hello ${s(d.name)},`, `Your one-time sign-in code is below. It expires in ${s(d.minutes)} minutes and can be used once.`, 'If this was not you, change your password immediately.'],
    code: s(d.otp),
  }),
  password_reset: (d) => ({
    subject: 'Reset your password',
    heading: 'Password reset',
    paragraphs: [`Hello ${s(d.name)},`, `We received a request to reset your password. The link below is valid for ${s(d.minutes)} minutes and can be used once.`, 'If you did not request this, you can safely ignore this email.'],
    cta: { label: 'Reset password', url: s(d.link) },
  }),
  password_reset_confirmation: (d) => ({
    subject: 'Your password was changed',
    heading: 'Password changed',
    paragraphs: [`Hello ${s(d.name)},`, 'Your password was changed successfully. All active sessions were signed out.', 'If you did not make this change, contact the journal office immediately.'],
  }),
  account_invite: (d) => ({
    subject: `Your ${env.APP_NAME} account`,
    heading: 'Set up your account',
    paragraphs: [`Hello ${s(d.name)},`, `An account with the role “${s(d.roleLabel)}” has been created for you. Set your password using the link below within ${s(d.hours)} hours.`, ...(d.reviewerCode ? [`Your Reviewer ID is ${s(d.reviewerCode)}.`] : [])],
    cta: { label: 'Set password', url: s(d.link) },
  }),
  submission_confirmation: (d) => ({
    subject: `Submission received: ${s(d.submissionId)}`,
    heading: 'Submission received',
    paragraphs: [`Hello ${s(d.name)},`, `Your manuscript “${s(d.title)}” was submitted with the ID ${s(d.submissionId)}. You can track its status in the portal.`],
    cta: d.link ? { label: 'View submission', url: s(d.link) } : undefined,
  }),
  apc_status: (d) => ({
    subject: `Payment status for ${s(d.submissionId)}: ${s(d.status)}`,
    heading: 'Article Publishing Charge update',
    paragraphs: [`Hello ${s(d.name)},`, `The Article Publishing Charge status for ${s(d.submissionId)} is now “${s(d.status)}”.${d.amount ? ` Amount: ${s(d.amount)} ${s(d.currency)}.` : ''}`],
    cta: d.link ? { label: 'View submission', url: s(d.link) } : undefined,
  }),
  editor_new_submission: (d) => ({
    subject: `New submission awaiting screening: ${s(d.submissionId)}`,
    heading: 'New submission',
    paragraphs: [`Submission ${s(d.submissionId)} (“${s(d.title)}”) is waiting in the screening queue.`],
    cta: d.link ? { label: 'Open submission', url: s(d.link) } : undefined,
  }),
  editor_assigned: (d) => ({
    subject: `You were assigned submission ${s(d.submissionId)}`,
    heading: 'Editor assignment',
    paragraphs: [`You have been assigned as editor for ${s(d.submissionId)} (“${s(d.title)}”).`],
    cta: d.link ? { label: 'Open submission', url: s(d.link) } : undefined,
  }),
  screening_rejected: (d) => ({
    subject: `Decision on ${s(d.submissionId)}`,
    heading: 'Editorial screening decision',
    paragraphs: [`Hello ${s(d.name)},`, `After initial editorial screening, your submission ${s(d.submissionId)} (“${s(d.title)}”) will not proceed to peer review. This submission is closed and cannot be resubmitted.`, ...(d.message ? [s(d.message)] : [])],
  }),
  reviewer_assigned: (d) => ({
    subject: `Review invitation: ${s(d.submissionId)}`,
    heading: 'You have been assigned a manuscript',
    paragraphs: [`Hello ${s(d.name)},`, `You have been assigned manuscript ${s(d.submissionId)} (“${s(d.title)}”) for double-blind peer review.${d.dueDate ? ` Please submit your review by ${s(d.dueDate)}.` : ''}`, 'Author identities are hidden. Submit your comments and recommendation through the portal.'],
    cta: d.link ? { label: 'Open assignment', url: s(d.link) } : undefined,
  }),
  reviewer_reminder: (d) => ({
    subject: `Reminder: review pending for ${s(d.submissionId)}`,
    heading: 'Review reminder',
    paragraphs: [`Hello ${s(d.name)},`, `This is a reminder that your review of ${s(d.submissionId)} is pending.${d.dueDate ? ` Due: ${s(d.dueDate)}.` : ''}`],
    cta: d.link ? { label: 'Open assignment', url: s(d.link) } : undefined,
  }),
  review_submitted_reviewer: (d) => ({
    subject: `Review submitted for ${s(d.submissionId)}`,
    heading: 'Thank you for your review',
    paragraphs: [`Hello ${s(d.name)},`, `Your review of ${s(d.submissionId)} was submitted and locked. The editor will consider it.`],
  }),
  reviewer_declined_editor: (d) => ({
    subject: `A reviewer declined ${s(d.submissionId)}`,
    heading: 'Reviewer declined',
    paragraphs: [`A reviewer declined the assignment for ${s(d.submissionId)} (“${s(d.title)}”). Please assign a replacement.`],
    cta: d.link ? { label: 'Open submission', url: s(d.link) } : undefined,
  }),
  reviews_received_editor: (d) => ({
    subject: `Both reviews received: ${s(d.submissionId)}`,
    heading: 'Reviews received',
    paragraphs: [`Both reviewer reports for ${s(d.submissionId)} (“${s(d.title)}”) are in. You can now review them and record the final decision.`],
    cta: d.link ? { label: 'Open submission', url: s(d.link) } : undefined,
  }),
  decision_author: (d) => ({
    subject: `Editorial decision for ${s(d.submissionId)}`,
    heading: 'Editorial decision',
    paragraphs: [`Hello ${s(d.name)},`, `The editor has made a decision on ${s(d.submissionId)} (“${s(d.title)}”): ${s(d.decision)}.`, ...(d.message ? [s(d.message)] : []), 'Any reviewer comments approved by the editor are available in the portal.'],
    cta: d.link ? { label: 'View decision', url: s(d.link) } : undefined,
  }),
  revision_requested_author: (d) => ({
    subject: `Revision requested for ${s(d.submissionId)}`,
    heading: 'Revision requested',
    paragraphs: [`Hello ${s(d.name)},`, `The editor has requested a revision of ${s(d.submissionId)} (“${s(d.title)}”).`, ...(d.message ? [s(d.message)] : [])],
    cta: d.link ? { label: 'View details', url: s(d.link) } : undefined,
  }),
  production_pending: (d) => ({
    subject: `Accepted article ready for production: ${s(d.submissionId)}`,
    heading: 'New article in production queue',
    paragraphs: [`Article ${s(d.submissionId)} (“${s(d.title)}”) has been accepted and is awaiting production.`],
    cta: d.link ? { label: 'Open article', url: s(d.link) } : undefined,
  }),
  proof_available: (d) => ({
    subject: `Proof available for review: ${s(d.submissionId)}`,
    heading: 'Your proof is ready',
    paragraphs: [`Hello ${s(d.name)},`, `A proof of ${s(d.submissionId)} (“${s(d.title)}”) is ready. Please review it and either approve it or list the corrections required.`],
    cta: d.link ? { label: 'Review proof', url: s(d.link) } : undefined,
  }),
  corrections_received_production: (d) => ({
    subject: `Author corrections received: ${s(d.submissionId)}`,
    heading: 'Corrections submitted',
    paragraphs: [`The author has returned corrections for ${s(d.submissionId)} (“${s(d.title)}”).`],
    cta: d.link ? { label: 'Open article', url: s(d.link) } : undefined,
  }),
  proof_approved_production: (d) => ({
    subject: `Proof approved: ${s(d.submissionId)}`,
    heading: 'Proof approved by the author',
    paragraphs: [`The author approved the proof of ${s(d.submissionId)} (“${s(d.title)}”). Final production can proceed.`],
    cta: d.link ? { label: 'Open article', url: s(d.link) } : undefined,
  }),
  major_change_editor: (d) => ({
    subject: `Major content change needs your review: ${s(d.submissionId)}`,
    heading: 'Major content change',
    paragraphs: [`A major content change was requested during production of ${s(d.submissionId)} (“${s(d.title)}”). Production is paused until you decide.`],
    cta: d.link ? { label: 'Review change', url: s(d.link) } : undefined,
  }),
  major_change_decided: (d) => ({
    subject: `Major change decision for ${s(d.submissionId)}`,
    heading: 'Major content change decision',
    paragraphs: [`The editor has ${s(d.decision)} a requested major content change for ${s(d.submissionId)}.`, ...(d.note ? [`Note: ${s(d.note)}`] : [])],
    cta: d.link ? { label: 'Open article', url: s(d.link) } : undefined,
  }),
  production_complete: (d) => ({
    subject: `Production complete: ${s(d.submissionId)}`,
    heading: 'Ready for publication',
    paragraphs: [`Final HTML and PDF files for ${s(d.submissionId)} (“${s(d.title)}”) are ready for publication authorisation.`],
    cta: d.link ? { label: 'Open article', url: s(d.link) } : undefined,
  }),
  published_author: (d) => ({
    subject: `Your article is published: ${s(d.submissionId)}`,
    heading: 'Article published',
    paragraphs: [`Hello ${s(d.name)},`, `“${s(d.title)}” has been published${d.publishedAt ? ` on ${s(d.publishedAt)}` : ''}.`],
    cta: d.link ? { label: 'View article', url: s(d.link) } : undefined,
  }),
  reviewer_application_received: (d) => ({
    subject: 'We received your reviewer application',
    heading: 'Application received',
    paragraphs: [`Hello ${s(d.name)},`, 'Thank you for applying to become a reviewer. The editor will review your application and contact you.'],
  }),
  reviewer_application_rejected: (d) => ({
    subject: 'Your reviewer application',
    heading: 'Application outcome',
    paragraphs: [`Hello ${s(d.name)},`, 'Thank you for your interest. We are unable to approve your reviewer application at this time.', ...(d.note ? [s(d.note)] : [])],
  }),
  reviewer_application_pending_editor: (d) => ({
    subject: 'New reviewer application',
    heading: 'Reviewer application',
    paragraphs: ['A new reviewer application is waiting for approval.'],
    cta: d.link ? { label: 'Open applications', url: s(d.link) } : undefined,
  }),
};

export type TemplateName = keyof typeof templates;
export const templateNames = Object.keys(templates);

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim();

export function renderEmail(name: string, data: D): RenderedEmail {
  const build = templates[name];
  if (!build) throw new Error(`Unknown email template: ${name}`);
  const spec = build(data);
  const subject = oneLine(spec.subject);
  const paragraphs = spec.paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join('');
  const code = spec.code
    ? `<p style="margin:18px 0;font-size:30px;letter-spacing:8px;font-weight:700;font-family:monospace">${esc(spec.code)}</p>`
    : '';
  const cta = spec.cta
    ? `<p style="margin:22px 0"><a href="${esc(spec.cta.url)}" style="background:#0b5cab;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;display:inline-block">${esc(spec.cta.label)}</a></p><p style="font-size:12px;color:#666;word-break:break-all">${esc(spec.cta.url)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1d2733"><div style="max-width:560px;margin:24px auto;background:#fff;border-radius:8px;padding:28px"><h2 style="margin:0 0 18px">${esc(spec.heading)}</h2>${paragraphs}${code}${cta}<hr style="border:none;border-top:1px solid #e3e7eb;margin:24px 0"><p style="font-size:12px;color:#777;margin:0">${esc(env.APP_NAME)} — this is an automated message.</p></div></body></html>`;
  const text = [spec.heading, '', ...spec.paragraphs, ...(spec.code ? ['', spec.code] : []), ...(spec.cta ? ['', `${spec.cta.label}: ${spec.cta.url}`] : []), '', `${env.APP_NAME} — automated message`].join('\n');
  return { subject, html, text };
}
