# Workflow, statuses and business rules

Source: BRD/FRD §6, §10, §13. The transition table lives in `src/constants/workflow.ts`; prerequisites live in `src/services/workflow.service.ts`. Any other move returns **409 `INVALID_STATE_TRANSITION`**. Every transition is written to `ArticleStatusHistory` (actor, role, reason, request id) and the audit log in the same DB transaction.

## Status graph

```
Submitted
  └─ start screening ─▶ Under Editorial Screening
        ├─ REJECT ─▶ Rejected at Screening            (terminal — closed, no resubmission, BR-007)
        └─ PROCEED ─▶ Plagiarism Check
              ├─ CLEAR  ─▶ Ready for Reviewer Assignment
              └─ REJECT ─▶ Rejected                    (terminal)
Ready for Reviewer Assignment ─ assign exactly 2 reviewers ─▶ Under Review
Under Review ─ both reviews submitted (automatic) ─▶ Reviews Received
Reviews Received ─▶ Under Editorial Decision ─ final decision ─┬─ REJECT ─▶ Rejected
                                                              ├─ ACCEPT ─▶ Accepted – Production Pending
                                                              └─ REQUEST_REVISION ─▶ Revision Requested*  ─ author uploads revision ─▶ Under Editorial Decision
Accepted – Production Pending ─▶ In Production
In Production ─ proof sent ─▶ Proof Sent to Author
Proof Sent to Author ├─ author approves ─▶ Final Production
                     └─ author returns corrections ─▶ Correction Required
Correction Required  ├─ minor corrections implemented + revised proof ─▶ Proof Sent to Author
                     ├─ all corrections resolved ─▶ Final Production
                     └─ major change escalated ─▶ Major Content Change – Editor Review ─ Editor decides all ─▶ Correction Required
Final Production ─ Editor/Admin publishes ─▶ Published   (terminal)
```
\* `Revision Requested` is **not in the BRD**. It is reachable only when `ALLOW_REVISION_AFTER_REVIEW` / `allowRevisionAfterReview` is enabled (PCI open item). By default the decision is rejected with `REVISION_NOT_ENABLED`.

## Prerequisites enforced by the workflow service

| Entering | Requirement |
|---|---|
| Under Editorial Screening | If `apcEnforcement=block`: APC `PAID` or `WAIVED` (otherwise only flagged) |
| Ready for Reviewer Assignment | Latest check of the **current manuscript version** is `COMPLETED` with verdict `CLEAR` (BR-008) |
| Under Review | Exactly 2 live assignments in slots 1 and 2 (BR-009); no auto-allocation exists |
| Reviews Received | Both live assignments `SUBMITTED` with submitted reports |
| Proof Sent to Author | A proof delivered to the author; no unresolved corrections |
| Correction Required (from proof) | ≥ 1 open correction. (from major-change review) no escalation still undecided |
| Major Content Change – Editor Review | ≥ 1 escalated correction |
| Final Production | No open / escalated / approved-but-unimplemented corrections; if coming from proof review, the proof is author-approved |
| Published | Final HTML **and** PDF, production hand-off complete, ≥ 1 keyword and author, and every field in `publicationRequiredMetadata` set |

## Rules worth knowing

- **Actors**: Editor = screening, plagiarism, reviewer allocation, comment moderation, final decision, major-change decisions, publication. Admin can do everything an Editor can plus user/role/config management and editor assignment. Production cannot take editorial or publication-authorisation actions (BR-017).
- **Editor scoping**: an Editor sees articles assigned to them and unassigned ones; the Admin sees all.
- **Reviewers**: eligibility is *advisory* (BR-011: M.Pharm or ≥ N years teaching, N configurable). Hard blocks: reviewer is the submitting author, listed as an author, previously assigned to the same article, or inactive. A reviewer may decline; the Editor replaces them (`/reviewers/:assignmentId/replace`). A submitted review can never be replaced or edited.
- **Recommendations** are advisory; the Editor's decision is independent (BR-016).
- **Comment disclosure**: reviewer comments go to the Editor first; only comments the Editor approves (optionally edited) are returned to the author after the final decision. `CONFIDENTIAL_TO_EDITOR` comments can never be released (API + DB constraint).
- **Word limit**: counted server-side from the .docx; exceeding `wordLimit` (default 5000) sets `wordLimitExceeded` (flag, not a block — FR-003).
- **Payment**: transitions `PENDING→PAID|FAILED|WAIVED`, `FAILED→PENDING|PAID|WAIVED`, `PAID→REFUNDED`; everything else is rejected. Gateway webhooks are idempotent.
- **Major changes**: author-declared MAJOR corrections, or minor ones escalated by Production, stop Production until the Editor approves/rejects (BR-019). Approved majors are then implemented by Production.
- **Resubmission**: not supported after screening rejection (closed). Post-review revision follows the configurable rule above.
- **Concurrency**: status changes use an optimistic `WHERE status = <expected>` guard; simultaneous reviewer submissions are serialised with a row lock.
