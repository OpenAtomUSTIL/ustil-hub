ALTER TABLE "users" ALTER COLUMN "email_notice_enabled" SET DEFAULT true;--> statement-breakpoint
-- 「公告通知默认开启」落地到存量账号：功能上线仅一天且默认值原为关，false 行即"从未选过"，一并翻转为开（用户仍可自行关闭/退订）
UPDATE "users" SET "email_notice_enabled" = true WHERE "email_notice_enabled" = false;