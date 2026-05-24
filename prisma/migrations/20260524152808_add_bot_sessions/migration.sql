-- CreateTable
CREATE TABLE "bot_sessions" (
    "id" TEXT NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "user_id" TEXT,
    "current_step" TEXT NOT NULL,
    "active_meeting_request_id" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_sessions_telegram_id_key" ON "bot_sessions"("telegram_id");

-- CreateIndex
CREATE INDEX "bot_sessions_user_id_idx" ON "bot_sessions"("user_id");

-- CreateIndex
CREATE INDEX "bot_sessions_current_step_idx" ON "bot_sessions"("current_step");

-- AddForeignKey
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
