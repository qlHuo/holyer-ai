ALTER TABLE "chunks" ADD COLUMN "content_tokens" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', content_tokens)) STORED;--> statement-breakpoint
CREATE INDEX "idx_chunks_content_tsv" ON "chunks" USING gin ("content_tsv");