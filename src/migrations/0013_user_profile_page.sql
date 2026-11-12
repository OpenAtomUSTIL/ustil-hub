ALTER TABLE "users" ADD COLUMN "bio" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_readme" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pinned_items" jsonb DEFAULT '[]'::jsonb;