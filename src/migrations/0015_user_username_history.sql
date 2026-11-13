CREATE TABLE "user_username_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"username" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_username_history" ADD CONSTRAINT "user_username_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_history_username_key" ON "user_username_history" USING btree ("username");--> statement-breakpoint
CREATE INDEX "user_username_history_user_id_idx" ON "user_username_history" USING btree ("user_id");