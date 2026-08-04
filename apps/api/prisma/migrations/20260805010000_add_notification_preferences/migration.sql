-- Notification preferences for signal distribution (Telegram, Discord, Email)
CREATE TABLE IF NOT EXISTS "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "telegram_chat_id" TEXT,
    "telegram_enabled" BOOLEAN NOT NULL DEFAULT false,
    "discord_webhook_url" TEXT,
    "discord_enabled" BOOLEAN NOT NULL DEFAULT false,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_confidence" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

ALTER TABLE "notification_preferences"
    ADD CONSTRAINT "notification_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS policies
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notification_preferences_owner_select"
    ON "notification_preferences" FOR SELECT
    USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "notification_preferences_owner_insert"
    ON "notification_preferences" FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "notification_preferences_owner_update"
    ON "notification_preferences" FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true));

CREATE POLICY "notification_preferences_owner_delete"
    ON "notification_preferences" FOR DELETE
    USING (user_id = current_setting('app.current_user_id', true));
