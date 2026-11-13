ALTER TYPE "public"."notification_type" ADD VALUE 'FOLLOW';--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"follower_id" uuid NOT NULL,
	"followee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "assignments" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "issues" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "resources" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "announcements" SET "slug" = (CASE WHEN btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') = '' THEN substr(replace("id"::text, '-', ''), 1, 8) ELSE btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') END);--> statement-breakpoint
UPDATE "articles" SET "slug" = (CASE WHEN btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') = '' THEN substr(replace("id"::text, '-', ''), 1, 8) ELSE btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') END);--> statement-breakpoint
UPDATE "assignments" SET "slug" = (CASE WHEN btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') = '' THEN substr(replace("id"::text, '-', ''), 1, 8) ELSE btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') END);--> statement-breakpoint
UPDATE "issues" SET "slug" = (CASE WHEN btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') = '' THEN substr(replace("id"::text, '-', ''), 1, 8) ELSE btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') END);--> statement-breakpoint
UPDATE "resources" SET "slug" = (CASE WHEN btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') = '' THEN substr(replace("id"::text, '-', ''), 1, 8) ELSE btrim(regexp_replace(lower(trim("title")), '[^0-9a-z一-龥]+', '-', 'g'), '-') END);--> statement-breakpoint
UPDATE "users" SET "username" = (CASE WHEN "nickname" ~ '^[A-Za-z0-9_-]{2,32}$' THEN lower("nickname") ELSE 'user-' || substr(md5("id"::text), 1, 8) END);--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "announcements") UPDATE "announcements" a SET "slug" = a."slug" || '-' || s.rn FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "articles") UPDATE "articles" a SET "slug" = a."slug" || '-' || s.rn FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "assignments") UPDATE "assignments" a SET "slug" = a."slug" || '-' || s.rn FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "issues") UPDATE "issues" a SET "slug" = a."slug" || '-' || s.rn FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "resources") UPDATE "resources" a SET "slug" = a."slug" || '-' || s.rn FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "username", row_number() OVER (PARTITION BY "username" ORDER BY "created_at", "id") AS rn FROM "users") UPDATE "users" u SET "username" = u."username" || '-' || s.rn FROM s WHERE u."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "announcements") UPDATE "announcements" a SET "slug" = a."slug" || '-' || substr(replace(a."id"::text, '-', ''), 1, 6) FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "articles") UPDATE "articles" a SET "slug" = a."slug" || '-' || substr(replace(a."id"::text, '-', ''), 1, 6) FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "assignments") UPDATE "assignments" a SET "slug" = a."slug" || '-' || substr(replace(a."id"::text, '-', ''), 1, 6) FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "issues") UPDATE "issues" a SET "slug" = a."slug" || '-' || substr(replace(a."id"::text, '-', ''), 1, 6) FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "slug", row_number() OVER (PARTITION BY "slug" ORDER BY "created_at", "id") AS rn FROM "resources") UPDATE "resources" a SET "slug" = a."slug" || '-' || substr(replace(a."id"::text, '-', ''), 1, 6) FROM s WHERE a."id" = s."id" AND s.rn > 1;--> statement-breakpoint
WITH s AS (SELECT "id", "username", row_number() OVER (PARTITION BY "username" ORDER BY "created_at", "id") AS rn FROM "users") UPDATE "users" u SET "username" = u."username" || '-' || substr(replace(u."id"::text, '-', ''), 1, 6) FROM s WHERE u."id" = s."id" AND s.rn > 1;--> statement-breakpoint
ALTER TABLE "announcements" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "assignments" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "issues" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "resources" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_follows_follower_followee_key" ON "user_follows" USING btree ("follower_id","followee_id");--> statement-breakpoint
CREATE INDEX "user_follows_followee_id_idx" ON "user_follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "user_follows_follower_id_idx" ON "user_follows" USING btree ("follower_id");--> statement-breakpoint
CREATE UNIQUE INDEX "announcements_slug_key" ON "announcements" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_key" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_slug_key" ON "assignments" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_key" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "issues_slug_key" ON "issues" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "resources_slug_key" ON "resources" USING btree ("slug");
