CREATE TYPE "public"."tag_target_type" AS ENUM('ARTICLE', 'ISSUE', 'RESOURCE');--> statement-breakpoint
CREATE TABLE "taggings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tag_id" uuid NOT NULL,
	"target_type" "tag_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "taggings" ADD CONSTRAINT "taggings_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "taggings_tag_target_key" ON "taggings" USING btree ("tag_id","target_type","target_id");--> statement-breakpoint
CREATE INDEX "taggings_target_idx" ON "taggings" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "taggings_tag_id_idx" ON "taggings" USING btree ("tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_name_key" ON "tags" USING btree ("name");