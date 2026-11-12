ALTER TABLE "articles" ADD COLUMN "status" text DEFAULT 'PUBLISHED' NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articles_status_idx" ON "articles" USING btree ("status");