-- Built-in plagiarism engine: cached manuscript text (internal corpus) and the detailed report.
ALTER TABLE "ManuscriptVersion" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "PlagiarismCheck" ADD COLUMN "report" JSONB;
