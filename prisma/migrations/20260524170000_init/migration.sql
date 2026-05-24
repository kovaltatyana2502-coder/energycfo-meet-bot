-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('TELEGRAM', 'EMAIL', 'PHONE', 'WHATSAPP', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingTopic" AS ENUM ('CORPORATE_FUNCTIONS', 'TARIFF_CAMPAIGN', 'INTEGRATED_APPROACH', 'OTHER');

-- CreateEnum
CREATE TYPE "MeetingRequestKind" AS ENUM ('INITIAL', 'RESCHEDULE');

-- CreateEnum
CREATE TYPE "MeetingRequestStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'DECLINED', 'CANCELLED_BY_USER', 'RESCHEDULE_PENDING', 'RESCHEDULED', 'SLA_OVERDUE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'RESCHEDULED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('TELEGRAM', 'EMAIL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('NEW_REQUEST', 'ADMIN_REMINDER_2H', 'ADMIN_REMINDER_12H', 'ADMIN_REMINDER_24H', 'USER_REMINDER_24H', 'USER_REMINDER_1H', 'REQUEST_APPROVED', 'REQUEST_DECLINED', 'REQUEST_AUTO_CANCELLED', 'MEETING_CANCELLED', 'RESCHEDULE_REQUESTED', 'RESCHEDULE_APPROVED', 'RESCHEDULE_DECLINED', 'TECHNICAL_ERROR');

-- CreateEnum
CREATE TYPE "SystemLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "telegram_id" TEXT NOT NULL,
    "telegram_username" TEXT,
    "telegram_first_name" TEXT,
    "telegram_last_name" TEXT,
    "full_name" TEXT,
    "company" TEXT,
    "position" TEXT,
    "email" TEXT,
    "consent_given_at" TIMESTAMP(3),
    "deletion_requested_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "meeting_request_id" TEXT,
    "channel" "ContactChannel" NOT NULL,
    "value" TEXT,
    "label" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meeting_requests" (
    "id" TEXT NOT NULL,
    "request_number" SERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "MeetingRequestKind" NOT NULL DEFAULT 'INITIAL',
    "status" "MeetingRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "topic" "MeetingTopic",
    "topic_text" TEXT,
    "comment" TEXT,
    "selected_start_at" TIMESTAMP(3),
    "selected_end_at" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "decline_reason" TEXT,
    "alternative_slots" JSONB,
    "replaces_meeting_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "declined_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "sla_overdue_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "meeting_request_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "google_calendar_id" TEXT,
    "google_event_id" TEXT,
    "google_meet_link" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "working_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "working_hours_start" TEXT NOT NULL DEFAULT '10:00',
    "working_hours_end" TEXT NOT NULL DEFAULT '18:00',
    "meeting_duration_minutes" INTEGER NOT NULL DEFAULT 60,
    "meeting_buffer_minutes" INTEGER NOT NULL DEFAULT 30,
    "meeting_min_lead_hours" INTEGER NOT NULL DEFAULT 12,
    "meeting_daily_limit" INTEGER NOT NULL DEFAULT 5,
    "user_booking_horizon_months" INTEGER NOT NULL DEFAULT 2,
    "admin_availability_horizon_months" INTEGER NOT NULL DEFAULT 3,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "availability_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "excluded_dates" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "reason" TEXT,
    "created_by_telegram_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excluded_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" TEXT NOT NULL,
    "meeting_request_id" TEXT NOT NULL,
    "old_status" "MeetingRequestStatus",
    "new_status" "MeetingRequestStatus" NOT NULL,
    "actor_role" "ActorRole" NOT NULL,
    "actor_telegram_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_tokens" (
    "id" TEXT NOT NULL,
    "provider_account_email" TEXT NOT NULL,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "token_type" TEXT,
    "expiry_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_log" (
    "id" TEXT NOT NULL,
    "meeting_request_id" TEXT,
    "meeting_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'TELEGRAM',
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "recipient_role" "ActorRole" NOT NULL,
    "recipient_telegram_id" TEXT,
    "recipient_email" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "error_message" TEXT,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_logs" (
    "id" TEXT NOT NULL,
    "meeting_request_id" TEXT,
    "level" "SystemLogLevel" NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_telegram_id_key" ON "users"("telegram_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "contact_preferences_user_id_idx" ON "contact_preferences"("user_id");

-- CreateIndex
CREATE INDEX "contact_preferences_meeting_request_id_idx" ON "contact_preferences"("meeting_request_id");

-- CreateIndex
CREATE INDEX "contact_preferences_channel_idx" ON "contact_preferences"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_requests_request_number_key" ON "meeting_requests"("request_number");

-- CreateIndex
CREATE INDEX "meeting_requests_user_id_created_at_idx" ON "meeting_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "meeting_requests_status_selected_start_at_idx" ON "meeting_requests"("status", "selected_start_at");

-- CreateIndex
CREATE INDEX "meeting_requests_kind_status_idx" ON "meeting_requests"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_meeting_request_id_key" ON "meetings"("meeting_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "meetings_google_event_id_key" ON "meetings"("google_event_id");

-- CreateIndex
CREATE INDEX "meetings_user_id_start_at_idx" ON "meetings"("user_id", "start_at");

-- CreateIndex
CREATE INDEX "meetings_status_start_at_idx" ON "meetings"("status", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "availability_settings_key_key" ON "availability_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "excluded_dates_date_timezone_key" ON "excluded_dates"("date", "timezone");

-- CreateIndex
CREATE INDEX "status_history_meeting_request_id_created_at_idx" ON "status_history"("meeting_request_id", "created_at");

-- CreateIndex
CREATE INDEX "status_history_new_status_created_at_idx" ON "status_history"("new_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "google_tokens_provider_account_email_key" ON "google_tokens"("provider_account_email");

-- CreateIndex
CREATE UNIQUE INDEX "notification_log_dedupe_key_key" ON "notification_log"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_log_meeting_request_id_type_idx" ON "notification_log"("meeting_request_id", "type");

-- CreateIndex
CREATE INDEX "notification_log_meeting_id_type_idx" ON "notification_log"("meeting_id", "type");

-- CreateIndex
CREATE INDEX "notification_log_status_scheduled_for_idx" ON "notification_log"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_module_created_at_idx" ON "system_logs"("module", "created_at");

-- CreateIndex
CREATE INDEX "system_logs_meeting_request_id_idx" ON "system_logs"("meeting_request_id");

-- AddForeignKey
ALTER TABLE "contact_preferences" ADD CONSTRAINT "contact_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_preferences" ADD CONSTRAINT "contact_preferences_meeting_request_id_fkey" FOREIGN KEY ("meeting_request_id") REFERENCES "meeting_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meeting_requests" ADD CONSTRAINT "meeting_requests_replaces_meeting_id_fkey" FOREIGN KEY ("replaces_meeting_id") REFERENCES "meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_meeting_request_id_fkey" FOREIGN KEY ("meeting_request_id") REFERENCES "meeting_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_meeting_request_id_fkey" FOREIGN KEY ("meeting_request_id") REFERENCES "meeting_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_meeting_request_id_fkey" FOREIGN KEY ("meeting_request_id") REFERENCES "meeting_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_log" ADD CONSTRAINT "notification_log_meeting_id_fkey" FOREIGN KEY ("meeting_id") REFERENCES "meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_logs" ADD CONSTRAINT "system_logs_meeting_request_id_fkey" FOREIGN KEY ("meeting_request_id") REFERENCES "meeting_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
