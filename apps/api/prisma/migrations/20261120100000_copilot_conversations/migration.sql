-- Copilot : historique de conversations par utilisateur (RLS).
CREATE TABLE "copilot_conversations" (
    "id"         TEXT        NOT NULL,
    "user_id"    TEXT        NOT NULL,
    "title"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "copilot_conversations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "copilot_conversations_user_id_fkey" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "copilot_conversations_user_id_updated_at_idx"
    ON "copilot_conversations"("user_id", "updated_at" DESC);

CREATE TABLE "copilot_messages" (
    "id"              TEXT        NOT NULL,
    "conversation_id" TEXT        NOT NULL,
    "role"            TEXT        NOT NULL,
    "content"         TEXT        NOT NULL,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "copilot_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id")
        REFERENCES "copilot_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "copilot_messages_conversation_id_created_at_idx"
    ON "copilot_messages"("conversation_id", "created_at");

ALTER TABLE "copilot_conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "copilot_messages" ENABLE ROW LEVEL SECURITY;

CREATE POLICY copilot_conversations_owner ON "copilot_conversations"
    USING ("user_id" = current_setting('app.current_user_id', true))
    WITH CHECK ("user_id" = current_setting('app.current_user_id', true));

CREATE POLICY copilot_messages_owner ON "copilot_messages"
    USING ("conversation_id" IN (
        SELECT "id" FROM "copilot_conversations"
        WHERE "user_id" = current_setting('app.current_user_id', true)))
    WITH CHECK ("conversation_id" IN (
        SELECT "id" FROM "copilot_conversations"
        WHERE "user_id" = current_setting('app.current_user_id', true)));

GRANT SELECT, INSERT, UPDATE, DELETE ON "copilot_conversations" TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON "copilot_messages" TO app_runtime;
