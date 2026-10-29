-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CHIEF_EDITOR_ADMIN', 'EDITOR', 'REVIEWER', 'AUTHOR', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'EMAIL_VERIFICATION');

-- CreateEnum
CREATE TYPE "ResetTokenPurpose" AS ENUM ('PASSWORD_RESET', 'ACCOUNT_INVITE');

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('SUBMITTED', 'UNDER_EDITORIAL_SCREENING', 'REJECTED_AT_SCREENING', 'PLAGIARISM_CHECK', 'READY_FOR_REVIEWER_ASSIGNMENT', 'UNDER_REVIEW', 'REVIEWS_RECEIVED', 'UNDER_EDITORIAL_DECISION', 'REVISION_REQUESTED', 'REJECTED', 'ACCEPTED_PRODUCTION_PENDING', 'IN_PRODUCTION', 'PROOF_SENT_TO_AUTHOR', 'CORRECTION_REQUIRED', 'MAJOR_CONTENT_CHANGE_EDITOR_REVIEW', 'FINAL_PRODUCTION', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('MANUSCRIPT', 'TITLE_PAGE', 'PLAGIARISM_REPORT', 'PROOF', 'FINAL_HTML', 'FINAL_PDF', 'REVIEWER_CV');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('ORIGINAL', 'REVISION');

-- CreateEnum
CREATE TYPE "ReviewerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReviewerAssignmentStatus" AS ENUM ('ASSIGNED', 'SUBMITTED', 'DECLINED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ReviewRecommendation" AS ENUM ('ACCEPT', 'MINOR_REVISION', 'MAJOR_REVISION', 'REJECT');

-- CreateEnum
CREATE TYPE "ReviewReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ReviewCommentSection" AS ENUM ('SUMMARY', 'ORIGINALITY', 'METHODOLOGY', 'RESULTS', 'ETHICS', 'LANGUAGE', 'OTHER', 'CONFIDENTIAL_TO_EDITOR');

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('PROCEED_TO_PLAGIARISM_CHECK', 'REJECT_AT_SCREENING', 'CLEAR_FOR_REVIEW', 'REJECT_AFTER_PLAGIARISM', 'ACCEPT', 'REJECT', 'REQUEST_REVISION');

-- CreateEnum
CREATE TYPE "PlagiarismStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlagiarismVerdict" AS ENUM ('CLEAR', 'CONCERN');

-- CreateEnum
CREATE TYPE "PlagiarismSource" AS ENUM ('API', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'WAIVED');

-- CreateEnum
CREATE TYPE "ProductionTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'AWAITING_AUTHOR', 'CORRECTIONS', 'AWAITING_EDITOR', 'FINALIZING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ProofAuthorStatus" AS ENUM ('PENDING_DELIVERY', 'PENDING_REVIEW', 'APPROVED', 'CORRECTIONS_REQUESTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "CorrectionType" AS ENUM ('MINOR', 'MAJOR');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('OPEN', 'IMPLEMENTED', 'ESCALATED', 'APPROVED_BY_EDITOR', 'REJECTED_BY_EDITOR');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "passwordChangedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthOtp" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" "ResetTokenPurpose" NOT NULL DEFAULT 'PASSWORD_RESET',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "affiliation" TEXT,
    "country" TEXT,
    "phone" TEXT,
    "orcid" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "AuthorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "designation" TEXT,
    "bio" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "EditorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectArea" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "reviewerCode" TEXT NOT NULL,
    "institution" TEXT,
    "designation" TEXT,
    "highestQualification" TEXT,
    "holdsMPharm" BOOLEAN NOT NULL DEFAULT false,
    "yearsTeaching" INTEGER NOT NULL DEFAULT 0,
    "qualificationNotes" TEXT,
    "eligibilityNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReviewerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerSubjectArea" (
    "reviewerId" UUID NOT NULL,
    "subjectAreaId" UUID NOT NULL,

    CONSTRAINT "ReviewerSubjectArea_pkey" PRIMARY KEY ("reviewerId","subjectAreaId")
);

-- CreateTable
CREATE TABLE "ReviewerApplication" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "institution" TEXT NOT NULL,
    "designation" TEXT,
    "highestQualification" TEXT NOT NULL,
    "holdsMPharm" BOOLEAN NOT NULL DEFAULT false,
    "yearsTeaching" INTEGER NOT NULL DEFAULT 0,
    "statement" TEXT NOT NULL,
    "cvFileId" UUID,
    "status" "ReviewerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "createdReviewerId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReviewerApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerApplicationSubjectArea" (
    "applicationId" UUID NOT NULL,
    "subjectAreaId" UUID NOT NULL,

    CONSTRAINT "ReviewerApplicationSubjectArea_pkey" PRIMARY KEY ("applicationId","subjectAreaId")
);

-- CreateTable
CREATE TABLE "Article" (
    "id" UUID NOT NULL,
    "submissionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "abstract" TEXT NOT NULL,
    "ethicsStatement" TEXT NOT NULL,
    "subjectAreaId" UUID,
    "status" "ArticleStatus" NOT NULL DEFAULT 'SUBMITTED',
    "authorId" UUID NOT NULL,
    "editorId" UUID,
    "currentWordCount" INTEGER NOT NULL DEFAULT 0,
    "wordLimitExceeded" BOOLEAN NOT NULL DEFAULT false,
    "screeningRejected" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "publishedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAuthor" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "affiliation" TEXT,
    "orcid" TEXT,
    "isCorresponding" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ArticleAuthor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleKeyword" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "keyword" TEXT NOT NULL,

    CONSTRAINT "ArticleKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileAsset" (
    "id" UUID NOT NULL,
    "articleId" UUID,
    "purpose" "FilePurpose" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManuscriptVersion" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "kind" "VersionKind" NOT NULL DEFAULT 'ORIGINAL',
    "fileId" UUID NOT NULL,
    "titlePageFileId" UUID,
    "wordCount" INTEGER NOT NULL,
    "changeNote" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManuscriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleStatusHistory" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "fromStatus" "ArticleStatus",
    "toStatus" "ArticleStatus" NOT NULL,
    "actorId" UUID,
    "actorRole" "Role",
    "reason" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewerAssignment" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "status" "ReviewerAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedById" UUID NOT NULL,
    "dueDate" TIMESTAMPTZ(6),
    "assignedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),
    "declineReason" TEXT,
    "lastReminderAt" TIMESTAMPTZ(6),
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "ReviewerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewReport" (
    "id" UUID NOT NULL,
    "assignmentId" UUID NOT NULL,
    "status" "ReviewReportStatus" NOT NULL DEFAULT 'DRAFT',
    "recommendation" "ReviewRecommendation",
    "submittedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewComment" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "section" "ReviewCommentSection" NOT NULL,
    "body" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "approvedForAuthor" BOOLEAN NOT NULL DEFAULT false,
    "editedBody" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditorialDecision" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "decision" "DecisionType" NOT NULL,
    "fromStatus" "ArticleStatus" NOT NULL,
    "toStatus" "ArticleStatus" NOT NULL,
    "notes" TEXT,
    "authorMessage" TEXT,
    "decidedById" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditorialDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlagiarismCheck" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "status" "PlagiarismStatus" NOT NULL DEFAULT 'PENDING',
    "source" "PlagiarismSource" NOT NULL,
    "provider" TEXT,
    "providerReference" TEXT,
    "similarityScore" DECIMAL(5,2),
    "verdict" "PlagiarismVerdict",
    "reportFileId" UUID,
    "notes" TEXT,
    "errorMessage" TEXT,
    "initiatedById" UUID NOT NULL,
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PlagiarismCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApcPayment" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" VARCHAR(3),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerReference" TEXT,
    "paidAt" TIMESTAMPTZ(6),
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ApcPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "assignedToId" UUID,
    "status" "ProductionTaskStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofVersion" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fileId" UUID NOT NULL,
    "notes" TEXT,
    "uploadedById" UUID NOT NULL,
    "sentToAuthorAt" TIMESTAMPTZ(6),
    "authorStatus" "ProofAuthorStatus" NOT NULL DEFAULT 'PENDING_DELIVERY',
    "authorRespondedAt" TIMESTAMPTZ(6),
    "authorFeedback" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProofVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "proofId" UUID NOT NULL,
    "type" "CorrectionType" NOT NULL DEFAULT 'MINOR',
    "status" "CorrectionStatus" NOT NULL DEFAULT 'OPEN',
    "location" TEXT,
    "description" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "implementedById" UUID,
    "implementedAt" TIMESTAMPTZ(6),
    "productionNote" TEXT,
    "escalatedAt" TIMESTAMPTZ(6),
    "editorDecidedById" UUID,
    "editorDecidedAt" TIMESTAMPTZ(6),
    "editorNote" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "articleId" UUID NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "htmlFileId" UUID,
    "pdfFileId" UUID,
    "publishedAt" TIMESTAMPTZ(6),
    "publishedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationMetadata" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "doi" TEXT,
    "volume" TEXT,
    "issue" TEXT,
    "pages" TEXT,
    "license" TEXT,
    "copyright" TEXT,
    "citation" TEXT,
    "extra" JSONB,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PublicationMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(6),
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "emailAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailError" TEXT,
    "emailSentAt" TIMESTAMPTZ(6),
    "emailTemplate" TEXT,
    "emailPayload" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "actorRole" "Role",
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "metadata" JSONB,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemConfig" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_status_idx" ON "User"("role", "status");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "User_lastName_firstName_idx" ON "User"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "AuthOtp_userId_purpose_createdAt_idx" ON "AuthOtp"("userId", "purpose", "createdAt");

-- CreateIndex
CREATE INDEX "AuthOtp_expiresAt_idx" ON "AuthOtp"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthSession_userId_revokedAt_idx" ON "AuthSession"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_sessionId_idx" ON "RefreshToken"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthorProfile_userId_key" ON "AuthorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EditorProfile_userId_key" ON "EditorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectArea_name_key" ON "SubjectArea"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerProfile_userId_key" ON "ReviewerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerProfile_reviewerCode_key" ON "ReviewerProfile"("reviewerCode");

-- CreateIndex
CREATE INDEX "ReviewerProfile_isActive_idx" ON "ReviewerProfile"("isActive");

-- CreateIndex
CREATE INDEX "ReviewerSubjectArea_subjectAreaId_idx" ON "ReviewerSubjectArea"("subjectAreaId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewerApplication_cvFileId_key" ON "ReviewerApplication"("cvFileId");

-- CreateIndex
CREATE INDEX "ReviewerApplication_status_createdAt_idx" ON "ReviewerApplication"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewerApplication_email_idx" ON "ReviewerApplication"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Article_submissionId_key" ON "Article"("submissionId");

-- CreateIndex
CREATE INDEX "Article_status_submittedAt_idx" ON "Article"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "Article_authorId_submittedAt_idx" ON "Article"("authorId", "submittedAt");

-- CreateIndex
CREATE INDEX "Article_editorId_status_idx" ON "Article"("editorId", "status");

-- CreateIndex
CREATE INDEX "Article_subjectAreaId_idx" ON "Article"("subjectAreaId");

-- CreateIndex
CREATE INDEX "Article_title_idx" ON "Article"("title");

-- CreateIndex
CREATE INDEX "ArticleAuthor_articleId_idx" ON "ArticleAuthor"("articleId");

-- CreateIndex
CREATE INDEX "ArticleAuthor_email_idx" ON "ArticleAuthor"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAuthor_articleId_orderIndex_key" ON "ArticleAuthor"("articleId", "orderIndex");

-- CreateIndex
CREATE INDEX "ArticleKeyword_keyword_idx" ON "ArticleKeyword"("keyword");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleKeyword_articleId_keyword_key" ON "ArticleKeyword"("articleId", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "FileAsset_storageKey_key" ON "FileAsset"("storageKey");

-- CreateIndex
CREATE INDEX "FileAsset_articleId_purpose_idx" ON "FileAsset"("articleId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "ManuscriptVersion_fileId_key" ON "ManuscriptVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ManuscriptVersion_titlePageFileId_key" ON "ManuscriptVersion"("titlePageFileId");

-- CreateIndex
CREATE UNIQUE INDEX "ManuscriptVersion_articleId_versionNumber_key" ON "ManuscriptVersion"("articleId", "versionNumber");

-- CreateIndex
CREATE INDEX "ArticleStatusHistory_articleId_createdAt_idx" ON "ArticleStatusHistory"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewerAssignment_articleId_status_idx" ON "ReviewerAssignment"("articleId", "status");

-- CreateIndex
CREATE INDEX "ReviewerAssignment_reviewerId_status_idx" ON "ReviewerAssignment"("reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewReport_assignmentId_key" ON "ReviewReport"("assignmentId");

-- CreateIndex
CREATE INDEX "ReviewComment_reportId_idx" ON "ReviewComment"("reportId");

-- CreateIndex
CREATE INDEX "EditorialDecision_articleId_decidedAt_idx" ON "EditorialDecision"("articleId", "decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlagiarismCheck_providerReference_key" ON "PlagiarismCheck"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PlagiarismCheck_reportFileId_key" ON "PlagiarismCheck"("reportFileId");

-- CreateIndex
CREATE INDEX "PlagiarismCheck_articleId_createdAt_idx" ON "PlagiarismCheck"("articleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApcPayment_articleId_key" ON "ApcPayment"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ApcPayment_providerReference_key" ON "ApcPayment"("providerReference");

-- CreateIndex
CREATE INDEX "ApcPayment_status_idx" ON "ApcPayment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_provider_eventId_key" ON "PaymentWebhookEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTask_articleId_key" ON "ProductionTask"("articleId");

-- CreateIndex
CREATE INDEX "ProductionTask_assignedToId_status_idx" ON "ProductionTask"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "ProductionTask_status_idx" ON "ProductionTask"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_fileId_key" ON "ProofVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofVersion_articleId_versionNumber_key" ON "ProofVersion"("articleId", "versionNumber");

-- CreateIndex
CREATE INDEX "Correction_articleId_status_idx" ON "Correction"("articleId", "status");

-- CreateIndex
CREATE INDEX "Correction_status_idx" ON "Correction"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_articleId_key" ON "Publication"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_htmlFileId_key" ON "Publication"("htmlFileId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_pdfFileId_key" ON "Publication"("pdfFileId");

-- CreateIndex
CREATE INDEX "Publication_status_publishedAt_idx" ON "Publication"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMetadata_publicationId_key" ON "PublicationMetadata"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationMetadata_doi_key" ON "PublicationMetadata"("doi");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_emailStatus_updatedAt_idx" ON "Notification"("emailStatus", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthOtp" ADD CONSTRAINT "AuthOtp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthorProfile" ADD CONSTRAINT "AuthorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorProfile" ADD CONSTRAINT "EditorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerProfile" ADD CONSTRAINT "ReviewerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerSubjectArea" ADD CONSTRAINT "ReviewerSubjectArea_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ReviewerProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerSubjectArea" ADD CONSTRAINT "ReviewerSubjectArea_subjectAreaId_fkey" FOREIGN KEY ("subjectAreaId") REFERENCES "SubjectArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerApplication" ADD CONSTRAINT "ReviewerApplication_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerApplication" ADD CONSTRAINT "ReviewerApplication_cvFileId_fkey" FOREIGN KEY ("cvFileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerApplicationSubjectArea" ADD CONSTRAINT "ReviewerApplicationSubjectArea_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "ReviewerApplication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerApplicationSubjectArea" ADD CONSTRAINT "ReviewerApplicationSubjectArea_subjectAreaId_fkey" FOREIGN KEY ("subjectAreaId") REFERENCES "SubjectArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_subjectAreaId_fkey" FOREIGN KEY ("subjectAreaId") REFERENCES "SubjectArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAuthor" ADD CONSTRAINT "ArticleAuthor_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleKeyword" ADD CONSTRAINT "ArticleKeyword_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileAsset" ADD CONSTRAINT "FileAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_titlePageFileId_fkey" FOREIGN KEY ("titlePageFileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManuscriptVersion" ADD CONSTRAINT "ManuscriptVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleStatusHistory" ADD CONSTRAINT "ArticleStatusHistory_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleStatusHistory" ADD CONSTRAINT "ArticleStatusHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerAssignment" ADD CONSTRAINT "ReviewerAssignment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerAssignment" ADD CONSTRAINT "ReviewerAssignment_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "ReviewerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewerAssignment" ADD CONSTRAINT "ReviewerAssignment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ManuscriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "ReviewerAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ReviewReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditorialDecision" ADD CONSTRAINT "EditorialDecision_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismCheck" ADD CONSTRAINT "PlagiarismCheck_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismCheck" ADD CONSTRAINT "PlagiarismCheck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ManuscriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlagiarismCheck" ADD CONSTRAINT "PlagiarismCheck_reportFileId_fkey" FOREIGN KEY ("reportFileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApcPayment" ADD CONSTRAINT "ApcPayment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofVersion" ADD CONSTRAINT "ProofVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correction" ADD CONSTRAINT "Correction_proofId_fkey" FOREIGN KEY ("proofId") REFERENCES "ProofVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_htmlFileId_fkey" FOREIGN KEY ("htmlFileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_pdfFileId_fkey" FOREIGN KEY ("pdfFileId") REFERENCES "FileAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationMetadata" ADD CONSTRAINT "PublicationMetadata_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemConfig" ADD CONSTRAINT "SystemConfig_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────────────────────────────────────────
-- Integrity rules that Prisma's schema language cannot express
-- ─────────────────────────────────────────────────────────────

-- A reviewer may hold only one live assignment per article, and each reviewer slot (1/2) only one.
CREATE UNIQUE INDEX "ReviewerAssignment_live_reviewer_key"
  ON "ReviewerAssignment" ("articleId", "reviewerId")
  WHERE "status" IN ('ASSIGNED', 'SUBMITTED');
CREATE UNIQUE INDEX "ReviewerAssignment_live_slot_key"
  ON "ReviewerAssignment" ("articleId", "slot")
  WHERE "status" IN ('ASSIGNED', 'SUBMITTED');
ALTER TABLE "ReviewerAssignment" ADD CONSTRAINT "ReviewerAssignment_slot_check" CHECK ("slot" IN (1, 2));

-- Non-negative / bounded values.
ALTER TABLE "ApcPayment" ADD CONSTRAINT "ApcPayment_amount_check" CHECK ("amount" IS NULL OR "amount" >= 0);
ALTER TABLE "PlagiarismCheck" ADD CONSTRAINT "PlagiarismCheck_score_check"
  CHECK ("similarityScore" IS NULL OR ("similarityScore" >= 0 AND "similarityScore" <= 100));
ALTER TABLE "Article" ADD CONSTRAINT "Article_wordcount_check" CHECK ("currentWordCount" >= 0);

-- A submitted review report must carry a recommendation and timestamp.
ALTER TABLE "ReviewReport" ADD CONSTRAINT "ReviewReport_submitted_check"
  CHECK ("status" <> 'SUBMITTED' OR ("recommendation" IS NOT NULL AND "submittedAt" IS NOT NULL));

-- Confidential-to-editor comments can never be released to authors.
ALTER TABLE "ReviewComment" ADD CONSTRAINT "ReviewComment_confidential_check"
  CHECK ("section" <> 'CONFIDENTIAL_TO_EDITOR' OR "approvedForAuthor" = false);

-- Audit log is append-only: block UPDATE, DELETE and TRUNCATE at the database level.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% not permitted)', TG_OP USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();

-- Status history is append-only as well.
CREATE TRIGGER "ArticleStatusHistory_no_update_delete"
  BEFORE UPDATE OR DELETE ON "ArticleStatusHistory"
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- Submitted review reports are locked at the database level (FR-018):
-- the recommendation / status / text of a submitted report cannot be changed or deleted by anyone.
-- Editor moderation (approvedForAuthor, editedBody, approvedById, approvedAt) remains allowed.
CREATE OR REPLACE FUNCTION review_report_locked() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'SUBMITTED' THEN
      RAISE EXCEPTION 'Submitted review reports cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'SUBMITTED' AND (
       NEW."status" <> OLD."status"
    OR NEW."recommendation" IS DISTINCT FROM OLD."recommendation"
    OR NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt"
    OR NEW."assignmentId" <> OLD."assignmentId") THEN
    RAISE EXCEPTION 'Submitted review reports cannot be modified' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReviewReport_locked"
  BEFORE UPDATE OR DELETE ON "ReviewReport"
  FOR EACH ROW EXECUTE FUNCTION review_report_locked();

CREATE OR REPLACE FUNCTION review_comment_locked() RETURNS trigger AS $$
DECLARE
  report_status "ReviewReportStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT "status" INTO report_status FROM "ReviewReport" WHERE "id" = NEW."reportId";
    IF report_status = 'SUBMITTED' THEN
      RAISE EXCEPTION 'Comments cannot be added to a submitted review' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT "status" INTO report_status FROM "ReviewReport" WHERE "id" = OLD."reportId";
  IF report_status = 'SUBMITTED' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Comments of a submitted review cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."body" <> OLD."body" OR NEW."section" <> OLD."section" OR NEW."reportId" <> OLD."reportId" OR NEW."orderIndex" <> OLD."orderIndex" THEN
      RAISE EXCEPTION 'Comments of a submitted review cannot be modified' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ReviewComment_locked"
  BEFORE INSERT OR UPDATE OR DELETE ON "ReviewComment"
  FOR EACH ROW EXECUTE FUNCTION review_comment_locked();
