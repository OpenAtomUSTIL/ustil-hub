CREATE TABLE "login_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text,
	"success" boolean NOT NULL,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "issue_replies" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "login_logs_created_at_idx" ON "login_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_logs_email_idx" ON "login_logs" USING btree ("email");--> statement-breakpoint
CREATE INDEX "announcements_deleted_at_idx" ON "announcements" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "articles_deleted_at_idx" ON "articles" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "users_last_seen_at_idx" ON "users" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "issue_replies_deleted_at_idx" ON "issue_replies" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "resources_deleted_at_idx" ON "resources" USING btree ("deleted_at");