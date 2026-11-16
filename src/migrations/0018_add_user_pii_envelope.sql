DROP INDEX "users_email_key";--> statement-breakpoint
DROP INDEX "users_phone_key";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "bio" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "company" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "location" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "link" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "crypto_id" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_hmac" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_hmac" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_hmac_key" ON "users" USING btree ("email_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_hmac_key" ON "users" USING btree ("phone_hmac");--> statement-breakpoint
CREATE UNIQUE INDEX "users_crypto_id_key" ON "users" USING btree ("crypto_id");