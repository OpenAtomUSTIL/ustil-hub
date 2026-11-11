CREATE TYPE "public"."invite_code_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TABLE "invite_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" "invite_code_status" DEFAULT 'ACTIVE' NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_codes_max_uses_chk" CHECK (max_uses >= 1 and max_uses <= 100),
	CONSTRAINT "invite_codes_used_count_chk" CHECK (used_count >= 0 and used_count <= max_uses)
);
--> statement-breakpoint
ALTER TABLE "assignment_submissions" DROP CONSTRAINT "assignment_submissions_submitter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "attachments" DROP CONSTRAINT "attachments_uploader_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "issues" DROP CONSTRAINT "issues_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_replies" DROP CONSTRAINT "issue_replies_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invite_code_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_key" ON "invite_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "invite_codes_status_idx" ON "invite_codes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invite_codes_created_by_id_idx" ON "invite_codes" USING btree ("created_by_id");--> statement-breakpoint
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_submitter_id_users_id_fk" FOREIGN KEY ("submitter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invite_code_id_invite_codes_id_fk" FOREIGN KEY ("invite_code_id") REFERENCES "public"."invite_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_replies" ADD CONSTRAINT "issue_replies_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "users_invite_code_id_idx" ON "users" USING btree ("invite_code_id");