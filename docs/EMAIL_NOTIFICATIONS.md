# E-mail and in-portal notifications

Transport: Nodemailer over SMTP (`SMTP_HOST/PORT/SECURE/USER/PASS`, `EMAIL_FROM`). Templates (HTML + plain text) are data-driven in `src/templates/email.ts`; link targets are in `src/templates/links.ts` (assumed frontend routes — adjust there).

## Delivery semantics

| Type | How it is sent | On failure |
|---|---|---|
| Security-critical (login OTP, verification OTP) | Synchronously, via `sendEmailOrFail` | Request fails with `503 EMAIL_DELIVERY_FAILED`; the OTP is voided. Never reported as delivered. |
| Password reset / confirmation | Background, same code path, generic API response | Logged; user can request again after the cooldown |
| Account invitations (staff, approved reviewers) | Sent after the DB commit | Response includes `inviteEmailSent:false`; Admin uses `POST /admin/users/:id/resend-invite` |
| Workflow notifications | Row in `Notification` created **in the business transaction**, e-mail sent after commit by the dispatcher | `emailStatus=FAILED`; retried every `EMAIL_RETRY_INTERVAL_SECONDS` up to `EMAIL_MAX_ATTEMPTS` |

Idempotency: each notification has a `dedupeKey` (unique per user), inserted with `ON CONFLICT DO NOTHING`, so a retried operation never creates or sends a duplicate. Dispatch claims rows atomically (`PENDING/FAILED → SENDING`), so multiple instances never send the same mail. `EMAIL_ENABLED=false` stores notifications as `NOT_REQUIRED` (nothing is claimed as sent).

Secrets (OTPs, reset tokens) are never stored in `Notification.emailPayload`.

## Catalogue (BRD §14)

| Event | Recipient | Template |
|---|---|---|
| Registration / login OTP | user | `verification_otp`, `login_otp` |
| Password reset / changed | user | `password_reset`, `password_reset_confirmation` |
| Account invitation (+ Reviewer ID) | staff / reviewer | `account_invite` |
| Submission confirmation | author | `submission_confirmation` |
| New submission / revision received | assigned editor, or all editors if unassigned | `editor_new_submission` |
| Editor assigned | editor | `editor_assigned` |
| APC / payment status change | author | `apc_status` |
| Rejected at screening | author | `screening_rejected` |
| Reviewer assignment / invitation | reviewer | `reviewer_assigned` |
| Reviewer reminder (≤ 1 per 24 h) | reviewer | `reviewer_reminder` |
| Review submission confirmation | reviewer | `review_submitted_reviewer` |
| Reviewer declined | editor | `reviewer_declined_editor` |
| Both reviews received | editor | `reviews_received_editor` |
| Final decision / revision requested | author | `decision_author`, `revision_requested_author` |
| Accepted → production queue / assignment | production | `production_pending` |
| Proof available | author | `proof_available` |
| Corrections returned / proof approved | production | `corrections_received_production`, `proof_approved_production` |
| Major content change needs decision | editor | `major_change_editor` |
| Major change decided | production | `major_change_decided` |
| Production complete (ready to publish) | editor | `production_complete` |
| Published | author | `published_author` |
| Reviewer application received / rejected | applicant | `reviewer_application_received`, `reviewer_application_rejected` |
| New reviewer application | editors | `reviewer_application_pending_editor` |

In-portal: `GET /notifications` (with `meta.unread`), `POST /notifications/:id/read`, `POST /notifications/read-all`. Final wording and channels are a PCI open item.
