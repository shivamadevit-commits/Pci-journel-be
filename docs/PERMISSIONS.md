# Role / permission matrix

> Generated from the route registry. ✔ = allowed. Every check is enforced server-side by middleware; row-level rules (ownership, assignment, editor scope) are applied additionally in the services.

| Endpoint | Public | Admin | Editor | Reviewer | Author | Prod |
|---|---|---|---|---|---|---|
| `POST /auth/register` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/verify-email` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/resend-verification` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/login` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/login/verify-otp` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/login/resend-otp` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/refresh` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/forgot-password` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/reset-password` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/logout` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /auth/change-password` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /auth/me` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /admin/dashboard` |  | ✔ |  |  |  |  |
| `GET /admin/users` |  | ✔ |  |  |  |  |
| `POST /admin/users` |  | ✔ |  |  |  |  |
| `GET /admin/users/:userId` |  | ✔ |  |  |  |  |
| `PUT /admin/users/:userId/role` |  | ✔ |  |  |  |  |
| `PUT /admin/users/:userId/status` |  | ✔ |  |  |  |  |
| `POST /admin/users/:userId/resend-invite` |  | ✔ |  |  |  |  |
| `GET /admin/editors` |  | ✔ |  |  |  |  |
| `PUT /admin/articles/:articleId/editor` |  | ✔ |  |  |  |  |
| `GET /admin/config` |  | ✔ |  |  |  |  |
| `PUT /admin/config` |  | ✔ |  |  |  |  |
| `GET /admin/audit-logs` |  | ✔ |  |  |  |  |
| `GET /admin/subject-areas` |  | ✔ |  |  |  |  |
| `POST /admin/subject-areas` |  | ✔ |  |  |  |  |
| `PATCH /admin/subject-areas/:subjectAreaId` |  | ✔ |  |  |  |  |
| `GET /subject-areas` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `PATCH /users/me/profile` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /notifications` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /notifications/read-all` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /notifications/:notificationId/read` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /author/dashboard` |  |  |  |  | ✔ |  |
| `GET /author/profile` |  |  |  |  | ✔ |  |
| `PATCH /author/profile` |  |  |  |  | ✔ |  |
| `POST /author/articles` |  |  |  |  | ✔ |  |
| `GET /author/articles` |  |  |  |  | ✔ |  |
| `GET /author/articles/:articleId` |  |  |  |  | ✔ |  |
| `POST /author/articles/:articleId/versions` |  |  |  |  | ✔ |  |
| `GET /author/articles/:articleId/payment` |  |  |  |  | ✔ |  |
| `POST /author/articles/:articleId/payment/verify` |  |  |  |  | ✔ |  |
| `POST /author/articles/:articleId/payment/checkout` |  |  |  |  | ✔ |  |
| `GET /author/articles/:articleId/proofs` |  |  |  |  | ✔ |  |
| `POST /author/articles/:articleId/proofs/:proofId/approve` |  |  |  |  | ✔ |  |
| `POST /author/articles/:articleId/proofs/:proofId/corrections` |  |  |  |  | ✔ |  |
| `GET /editorial/dashboard` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/history` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/screening/start` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/screening/decision` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/plagiarism` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/plagiarism/initiate` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/plagiarism/run` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/plagiarism/:checkId/report` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/plagiarism/record` |  | ✔ | ✔ |  |  |  |
| `PUT /editorial/articles/:articleId/plagiarism/:checkId/verdict` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/plagiarism/clearance` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/payment` |  | ✔ | ✔ |  |  |  |
| `PUT /editorial/articles/:articleId/payment` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/reviewers` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/reviewers/:reviewerId` |  | ✔ | ✔ |  |  |  |
| `PATCH /editorial/reviewers/:reviewerId` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/reviewers/:reviewerId/eligibility` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/reviewer-applications` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/reviewer-applications/:applicationId` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/reviewer-applications/:applicationId/approve` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/reviewer-applications/:applicationId/reject` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/reviewers` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/reviewers/:assignmentId/replace` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/reviewers/:assignmentId/remind` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/articles/:articleId/reviews` |  | ✔ | ✔ |  |  |  |
| `PUT /editorial/articles/:articleId/reviews/comments` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/articles/:articleId/decision` |  | ✔ | ✔ |  |  |  |
| `GET /editorial/major-changes` |  | ✔ | ✔ |  |  |  |
| `POST /editorial/major-changes/:correctionId/decision` |  | ✔ | ✔ |  |  |  |
| `POST /reviewer-applications` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /reviewer/dashboard` |  |  |  | ✔ |  |  |
| `GET /reviewer/profile` |  |  |  | ✔ |  |  |
| `GET /reviewer/assignments` |  |  |  | ✔ |  |  |
| `GET /reviewer/history` |  |  |  | ✔ |  |  |
| `GET /reviewer/assignments/:assignmentId` |  |  |  | ✔ |  |  |
| `POST /reviewer/assignments/:assignmentId/decline` |  |  |  | ✔ |  |  |
| `PUT /reviewer/assignments/:assignmentId/review` |  |  |  | ✔ |  |  |
| `POST /reviewer/assignments/:assignmentId/review/submit` |  |  |  | ✔ |  |  |
| `GET /production/dashboard` |  |  |  |  |  | ✔ |
| `GET /production/articles` |  | ✔ | ✔ |  |  | ✔ |
| `GET /production/articles/:articleId` |  | ✔ | ✔ |  |  | ✔ |
| `PUT /production/articles/:articleId/assignment` |  | ✔ | ✔ |  |  | ✔ |
| `POST /production/articles/:articleId/start` |  |  |  |  |  | ✔ |
| `POST /production/articles/:articleId/proofs` |  |  |  |  |  | ✔ |
| `GET /production/articles/:articleId/proofs` |  | ✔ | ✔ |  |  | ✔ |
| `POST /production/articles/:articleId/proofs/:proofId/send` |  |  |  |  |  | ✔ |
| `GET /production/articles/:articleId/corrections` |  | ✔ | ✔ |  |  | ✔ |
| `POST /production/corrections/:correctionId/implement` |  |  |  |  |  | ✔ |
| `POST /production/corrections/:correctionId/escalate` |  |  |  |  |  | ✔ |
| `PUT /production/articles/:articleId/final-files/:kind` |  |  |  |  |  | ✔ |
| `POST /production/articles/:articleId/complete` |  |  |  |  |  | ✔ |
| `GET /publication/articles/:articleId` |  | ✔ | ✔ |  |  | ✔ |
| `PUT /publication/articles/:articleId/metadata` |  | ✔ | ✔ |  |  | ✔ |
| `POST /publication/articles/:articleId/publish` |  | ✔ | ✔ |  |  |  |
| `GET /publications` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /publications/:submissionId` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /config/features` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /files/:fileId/download` |  | ✔ | ✔ | ✔ | ✔ | ✔ |
| `GET /publications/:submissionId/:kind` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /webhooks/payments` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| `POST /webhooks/plagiarism` | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

## Row-level rules

- **Author**: only their own articles, proofs, payment records and notifications. Never sees reviewer identities, assignments, internal notes, plagiarism data; sees reviewer comments only after a final decision and only those the Editor approved.
- **Reviewer**: only their own assignments; the manuscript view contains no author names/emails/affiliations/title page; manuscript downloads use a neutral filename and have document metadata scrubbed; submitted reviews are locked (also enforced by database triggers).
- **Editor**: articles assigned to them plus unassigned ones. Sees author and reviewer identities.
- **Admin**: all articles, user and role management, configuration, audit logs, editor assignment.
- **Production**: only accepted articles (Accepted – Production Pending onwards); no reviews, editorial decisions, plagiarism or APC data.
- **Public**: published articles only (metadata, HTML, PDF).
