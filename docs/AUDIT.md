# Activity / audit trail

## Schema (`AuditLog`)

| Column | Notes |
|---|---|
| `id` | bigserial, strictly increasing |
| `createdAt` | timestamptz (UTC) |
| `actorId`, `actorRole` | null for system / unauthenticated events (e.g. failed login for unknown e-mail, payment webhook) |
| `action` | dotted event name (catalogue below) |
| `entityType`, `entityId` | e.g. `Article`, `ReviewerAssignment`, `User` |
| `fromStatus`, `toStatus` | status transitions (article status, user role/status, payment status) |
| `metadata` | JSON, safe fields only (IDs, counts, decision names). Never passwords, tokens, OTPs, comment text or free-text personal data |
| `requestId` | correlation id (also returned in `X-Request-Id` and error bodies; present in app logs) |

In addition `ArticleStatusHistory` keeps one row per workflow transition (from, to, actor, role, reason, request id).

## Guarantees

- Written with the *same transaction client* as the change they describe (rolled back together).
- **Append-only at the database level**: triggers `AuditLog_no_update_delete`, `AuditLog_no_truncate` and `ArticleStatusHistory_no_update_delete` raise on UPDATE/DELETE/TRUNCATE. The API exposes no write endpoint for audit data. Foreign keys to users are `RESTRICT` and users are deactivated, never deleted.
- Retrieval: `GET /admin/audit-logs` (Admin only) with filters `actorId, action (prefix), entityType, entityId, from, to` + pagination. Editors get article-level history via `GET /editorial/articles/:id/history`.

## Event catalogue

`user.registered` · `user.email_verified` · `user.created` · `user.role_changed` · `user.status_changed` · `user.profile_updated` · `auth.login_success` · `auth.login_failed` · `auth.account_locked` · `auth.otp_failed` · `auth.logout` · `auth.password_reset_requested` · `auth.password_reset_completed` · `auth.password_changed` · `auth.account_invite_accepted` · `article.submitted` · `article.version_uploaded` · `article.status_changed` · `article.editor_assigned` · `editorial.screening_started` · `editorial.screening_decision` · `plagiarism.initiated` · `plagiarism.recorded` · `plagiarism.clearance_decision` · `reviewer.application_submitted|approved|rejected` · `reviewer.updated` · `review.reviewers_assigned` · `review.reviewer_replaced` · `review.reviewer_declined` · `review.reviewer_reminded` · `review.draft_saved` · `review.submitted` · `review.comment_disclosure_set` · `editorial.final_decision` · `payment.status_changed` · `payment.webhook_processed` · `production.assigned|started|proof_uploaded|proof_sent|correction_implemented|correction_escalated|final_file_uploaded|completed` · `proof.approved_by_author` · `proof.corrections_submitted` · `editorial.major_change_decision` · `publication.metadata_updated` · `publication.published` · `admin.config_changed` · `admin.subject_area_changed` · `file.downloaded`

Retention: no automatic deletion. Archive externally (e.g. OCI Logging / Object Storage export) per PCI's retention policy.
