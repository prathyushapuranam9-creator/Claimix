DROP INDEX "users_email_lower_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("users"."email" = lower("users"."email"));