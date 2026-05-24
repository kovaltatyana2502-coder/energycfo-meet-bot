import { z } from "zod";

const integerList = z
  .string()
  .min(1)
  .transform((value, ctx) => {
    const parsed = value.split(",").map((item) => Number.parseInt(item.trim(), 10));

    if (parsed.some((item) => Number.isNaN(item))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected comma-separated integers"
      });
      return z.NEVER;
    }

    return parsed;
  });

const booleanString = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("EnergyCFO Meetings Bot"),
  APP_BASE_URL: z.string().url().default("https://meet.energycfo.pro"),
  PORT: z.coerce.number().int().positive().default(3000),
  TIMEZONE: z.string().min(1).default("Europe/Moscow"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  TELEGRAM_BOT_TOKEN: z.string().min(1).default("replace_me"),
  TELEGRAM_ADMIN_ID: z.string().min(1).default("replace_me"),
  TELEGRAM_RUN_MODE: z.enum(["off", "polling", "webhook"]).default("webhook"),
  TELEGRAM_DROP_PENDING_UPDATES: booleanString.default(false),
  TELEGRAM_WEBHOOK_PATH: z.string().startsWith("/").default("/webhook"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).default("replace_me"),

  DATABASE_URL: z.string().min(1).default("postgresql://user:password@localhost:5432/energycfo_bot"),

  GOOGLE_CLIENT_ID: z.string().min(1).default("replace_me"),
  GOOGLE_CLIENT_SECRET: z.string().min(1).default("replace_me"),
  GOOGLE_REDIRECT_URI: z.string().url().default("https://meet.energycfo.pro/google/oauth/callback"),
  GOOGLE_REFRESH_TOKEN: z.string().min(1).default("replace_me"),
  GOOGLE_ADMIN_ACCOUNT: z.string().email().default("koval.tatyana.2502@gmail.com"),
  GOOGLE_CALENDAR_ID: z.string().min(1).default("replace_me"),
  GOOGLE_CALENDAR_NAME: z.string().min(1).default("Встречи с сайта CFO Energy Advisory"),

  WORKING_DAYS: integerList.default([1, 2, 3, 4, 5]),
  WORKING_HOURS_START: z.string().regex(/^\d{2}:\d{2}$/).default("10:00"),
  WORKING_HOURS_END: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  MEETING_DURATION_MINUTES: z.coerce.number().int().positive().default(60),
  MEETING_BUFFER_MINUTES: z.coerce.number().int().nonnegative().default(30),
  MEETING_MIN_LEAD_HOURS: z.coerce.number().int().nonnegative().default(12),
  MEETING_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
  USER_BOOKING_HORIZON_MONTHS: z.coerce.number().int().positive().default(2),
  ADMIN_AVAILABILITY_HORIZON_MONTHS: z.coerce.number().int().positive().default(3),

  ADMIN_REMINDER_AFTER_HOURS: integerList.default([2, 12, 24]),
  USER_REMINDER_BEFORE_HOURS: integerList.default([24, 1]),
  BACKGROUND_JOBS_INTERVAL_MINUTES: z.coerce.number().int().positive().default(10),

  BACKUP_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  MIN_FREE_DISK_PERCENT: z.coerce.number().int().min(0).max(100).default(20)
});

export type AppConfig = ReturnType<typeof loadConfig>;

export const loadConfig = (source: NodeJS.ProcessEnv = process.env) => {
  const parsed = envSchema.parse(source);

  return {
    app: {
      nodeEnv: parsed.NODE_ENV,
      name: parsed.APP_NAME,
      baseUrl: parsed.APP_BASE_URL,
      port: parsed.PORT,
      timezone: parsed.TIMEZONE,
      logLevel: parsed.LOG_LEVEL
    },
    telegram: {
      botToken: parsed.TELEGRAM_BOT_TOKEN,
      adminId: parsed.TELEGRAM_ADMIN_ID,
      runMode: parsed.TELEGRAM_RUN_MODE,
      dropPendingUpdates: parsed.TELEGRAM_DROP_PENDING_UPDATES,
      webhookPath: parsed.TELEGRAM_WEBHOOK_PATH,
      webhookSecret: parsed.TELEGRAM_WEBHOOK_SECRET
    },
    database: {
      url: parsed.DATABASE_URL
    },
    google: {
      clientId: parsed.GOOGLE_CLIENT_ID,
      clientSecret: parsed.GOOGLE_CLIENT_SECRET,
      redirectUri: parsed.GOOGLE_REDIRECT_URI,
      refreshToken: parsed.GOOGLE_REFRESH_TOKEN,
      adminAccount: parsed.GOOGLE_ADMIN_ACCOUNT,
      calendarId: parsed.GOOGLE_CALENDAR_ID,
      calendarName: parsed.GOOGLE_CALENDAR_NAME
    },
    scheduling: {
      workingDays: parsed.WORKING_DAYS,
      workingHoursStart: parsed.WORKING_HOURS_START,
      workingHoursEnd: parsed.WORKING_HOURS_END,
      meetingDurationMinutes: parsed.MEETING_DURATION_MINUTES,
      meetingBufferMinutes: parsed.MEETING_BUFFER_MINUTES,
      meetingMinLeadHours: parsed.MEETING_MIN_LEAD_HOURS,
      meetingDailyLimit: parsed.MEETING_DAILY_LIMIT,
      userBookingHorizonMonths: parsed.USER_BOOKING_HORIZON_MONTHS,
      adminAvailabilityHorizonMonths: parsed.ADMIN_AVAILABILITY_HORIZON_MONTHS
    },
    notifications: {
      adminReminderAfterHours: parsed.ADMIN_REMINDER_AFTER_HOURS,
      userReminderBeforeHours: parsed.USER_REMINDER_BEFORE_HOURS,
      backgroundJobsIntervalMinutes: parsed.BACKGROUND_JOBS_INTERVAL_MINUTES
    },
    operations: {
      backupRetentionDays: parsed.BACKUP_RETENTION_DAYS,
      logRetentionDays: parsed.LOG_RETENTION_DAYS,
      minFreeDiskPercent: parsed.MIN_FREE_DISK_PERCENT
    }
  };
};

export const isPlaceholderSecret = (value: string) =>
  value === "replace_me" || value === "PASTE_TELEGRAM_BOT_TOKEN_HERE" || value.trim() === "";
