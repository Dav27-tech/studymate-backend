ALTER TABLE "documents"
ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "processingError" TEXT,
ADD COLUMN "processingStartedAt" TIMESTAMP(3);

CREATE INDEX "documents_status_processingStartedAt_idx"
ON "documents"("status", "processingStartedAt");

CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_chunks_documentId_position_key"
ON "document_chunks"("documentId", "position");

CREATE INDEX "document_chunks_documentId_idx"
ON "document_chunks"("documentId");

ALTER TABLE "document_chunks"
ADD CONSTRAINT "document_chunks_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "documents"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
