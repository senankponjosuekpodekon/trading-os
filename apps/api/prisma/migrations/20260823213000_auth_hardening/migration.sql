ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "locked_until" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "email_verification_token" TEXT,
  ADD COLUMN IF NOT EXISTS "refresh_token_version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "refresh_tokens"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "users_email_verification_token_idx" ON "users"("email_verification_token");
