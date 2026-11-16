ALTER TABLE "users" ADD COLUMN "company" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "location" varchar(100);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "link" varchar(200);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "socials" jsonb DEFAULT '[]'::jsonb;