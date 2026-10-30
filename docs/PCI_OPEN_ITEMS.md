# Decisions and integrations awaiting PCI confirmation (BRD §17)

Nothing below is invented; each item has a configurable hook or a manual fallback so the module works today and can be finished when PCI confirms.

| # | BRD item | Current behaviour | What is needed to finish |
|---|---|---|---|
| 1 | Manuscript checklist / Word template | Only validates that the file is a real `.docx` (content-sniffed), counts words, flags > limit | Checklist rules → add validators in `article.service.submitArticle` |
| 2 | Reviewer eligibility | Advisory flag: M.Pharm **or** ≥ `reviewerMinYearsTeaching` (default 10, editable). Editor decides (BR-011) | Final criteria |
| 3 | Review form, scoring, recommendation options, deadlines | Structured comment sections (summary, originality, methodology, results, ethics, language, other, confidential-to-editor) + recommendation `ACCEPT / MINOR_REVISION / MAJOR_REVISION / REJECT`; due date optional (`REVIEW_DUE_DAYS` unset = none) | Final form fields and deadline policy |
| 4 | Plagiarism provider / API | Provider interface `PlagiarismProvider` (no vendor adapter), webhook `POST /webhooks/plagiarism` (HMAC-SHA256 in `X-Signature`, **generic contract chosen by us — adapt to the vendor's real callback**), and manual result entry with optional report upload | Vendor, credentials, commercial terms, real payload/auth scheme; similarity threshold policy if any (currently the Editor's verdict decides) |
| 5 | APC amount, gateway, refund rules, failure handling | Amount/currency empty until configured; manual recording by editorial staff; `PaymentProvider` interface (`createCheckout`, `verifyWebhook`, `fetchStatus`) with a Cashfree adapter (`PAYMENT_PROVIDER=cashfree`, ported from Digi-Pharmed); `POST /author/articles/:id/payment/verify` + idempotent webhook endpoint `POST /webhooks/payments`; `apcEnforcement` = `none` / `flag` (default) / `block` | Gateway + adapter, amount, enforcement policy (FR-004), refund workflow |
| 6 | HTML/PDF samples and webpage template | Final HTML and PDF are uploaded by Production and served as-is (HTML in a script-less sandbox) | Template / whether HTML needs assets (images) bundle |
| 7 | Required publication metadata | Title, abstract, authors, keywords, dates always present; extra fields (`doi, volume, issue, pages, license, copyright, citation`) required per `publicationRequiredMetadata` (default none) | Exact required list |
| 8 | Revision / resubmission after reviews | **Disabled** (`allowRevisionAfterReview=false`). When enabled: `REQUEST_REVISION` → `Revision Requested` → author uploads a new version → back to *Under Editorial Decision* (no automatic re-review) | PCI decision; re-review rules if revisions are allowed |
| 9 | Reject after production/proof stage; who controls publication | After acceptance there is no reject path. Publication authority = Editor / Admin (BR-016) | Confirmation (and a path if late rejection is needed) |
| 10 | Notification templates and channels | Plain, neutral HTML + text templates; e-mail + in-portal | Final wording, branding, any SMS/other channels |
| 11 | Frontend link paths in e-mails | Assumed `/reset-password`, `/set-password`, `/author/articles/:id`, `/editor/articles/:id`, `/reviewer/assignments/:id`, `/production/articles/:id`, `/articles/:submissionId` | Confirm with the frontend (single file `templates/links.ts`) |
| 12 | Data retention / audit export | Nothing is deleted automatically | Retention policy |
| 13 | Roles per user | One role per account (an Author who becomes a Reviewer needs a separate login e-mail) | Confirm single-role model is acceptable |

Other design decisions to confirm: submissions are created in one step (no draft status — BRD defines none); authors submit an anonymised manuscript plus an optional separate title page; Editors see assigned + unassigned articles, Admin sees all.
