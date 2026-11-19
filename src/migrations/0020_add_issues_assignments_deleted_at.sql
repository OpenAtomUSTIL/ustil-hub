ALTER TABLE "assignments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "assignments_deleted_at_idx" ON "assignments" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "issues_deleted_at_idx" ON "issues" USING btree ("deleted_at");