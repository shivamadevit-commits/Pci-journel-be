# Double-blind enforcement

Anonymity is enforced in the API, never by the frontend.

| Concern | Control |
|---|---|
| Reviewer DTOs contain no author data | `review.service.getMyAssignment` selects only submission ID, title, abstract, ethics statement, keywords, subject area and word count. No author, co-author, title page, e-mail or `authorId`. |
| Manuscript copy for reviewers | `GET /files/:id/download` for a reviewer returns a **neutral filename** (`manuscript.docx`) and a copy with `docProps` (creator, last-modified-by, company, manager, title…) and tracked-change/comment author names scrubbed. The optional **title page** (`titlePage`) is downloadable only by the author and editorial staff. Authors must also confirm (`confirmAnonymised`) that the manuscript is anonymised. |
| Reviewer access is assignment-bound | Only a live (`ASSIGNED`/`SUBMITTED`) assignment of that reviewer on that exact version unlocks the file; everything else returns 404. |
| Author DTOs contain no reviewer data | `article.service.getMyArticle` has no assignments/reports. Review text is available only through `review.service.authorFacingComments`: after a final decision, `approvedForAuthor = true` comments only, edited wording if the Editor supplied it, labelled "Reviewer A/B" (slot) — never an ID, name, institution or recommendation. |
| Comment flow | Reviewer → Editor first. The Editor moderates (`PUT /editorial/articles/:id/reviews/comments`). `CONFIDENTIAL_TO_EDITOR` comments can never be approved (service + DB check constraint). |
| Reviewer identity visible only to | Editor (for articles in their scope) and Chief Editor/Admin: `GET /editorial/articles/:id`, `…/reviews`, `/editorial/reviewers`. Production users never receive reviews, decisions or reviewer data. |
| Notifications / e-mail | Reviewer e-mails contain submission ID, title and due date only; author e-mails never include reviewer information; templates receive no identity fields from the opposite side. |
| Logs & audit | Reviewer actions are logged by assignment/article IDs; audit retrieval is Admin-only. Application logs never contain names or e-mails of reviewers/authors alongside review events. |
| Lock | A submitted review is timestamped and immutable (service rules + DB triggers `ReviewReport_locked`, `ReviewComment_locked`). |

Residual risk (cannot be solved purely in software): identity leaks inside the manuscript body text (self-citations, acknowledgements). The editor should screen for these during initial screening.
