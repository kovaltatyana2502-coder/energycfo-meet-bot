import {
  ActorRole,
  MeetingRequestKind,
  MeetingRequestStatus,
  MeetingStatus,
  NotificationStatus,
  NotificationType,
  Prisma,
  SystemLogLevel,
  type MeetingRequest,
  type PrismaClient
} from "@prisma/client";

import type { EnergyCfoBot } from "../bot/bot.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import { recordTechnicalError, runOperationsChecksOnce, type OperationsCheckStats } from "../operations/index.js";
import { formatSlotRange } from "../scheduling/availability.js";

type BackgroundJobsOptions = {
  config: AppConfig;
  logger: AppLogger;
  prisma: PrismaClient;
  bot: EnergyCfoBot | null;
};

type SendTelegramNotificationInput = {
  meetingRequestId?: string;
  meetingId?: string;
  type: NotificationType;
  recipientRole: ActorRole;
  recipientTelegramId: string | null;
  text: string;
  dedupeKey: string;
};

type JobRunStats = {
  adminReminders: number;
  autoCancelledRequests: number;
  userReminders: number;
  completedMeetings: number;
  operations: OperationsCheckStats | null;
};

const pendingDecisionStatuses = [
  MeetingRequestStatus.PENDING_APPROVAL,
  MeetingRequestStatus.RESCHEDULE_PENDING,
  MeetingRequestStatus.SLA_OVERDUE
];

export const getAdminReminderType = (hours: number) => {
  if (hours === 2) {
    return NotificationType.ADMIN_REMINDER_2H;
  }

  if (hours === 12) {
    return NotificationType.ADMIN_REMINDER_12H;
  }

  if (hours === 24) {
    return NotificationType.ADMIN_REMINDER_24H;
  }

  return null;
};

export const shouldAutoCancelRequest = (now: Date, selectedStartAt: Date | null, minLeadHours: number) =>
  Boolean(selectedStartAt && selectedStartAt.getTime() <= now.getTime() + minLeadHours * 60 * 60 * 1000);

export const shouldSendMeetingReminder = (now: Date, startAt: Date, hoursBefore: number) => {
  const millisecondsUntilStart = startAt.getTime() - now.getTime();

  if (millisecondsUntilStart <= 0) {
    return false;
  }

  if (hoursBefore === 24) {
    return millisecondsUntilStart <= 24 * 60 * 60 * 1000 && millisecondsUntilStart > 60 * 60 * 1000;
  }

  return millisecondsUntilStart <= hoursBefore * 60 * 60 * 1000;
};

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const formatRequestKind = (request: Pick<MeetingRequest, "kind">) =>
  request.kind === MeetingRequestKind.RESCHEDULE ? "заявка на перенос" : "заявка на встречу";

const createPendingNotificationLog = async (
  prisma: PrismaClient,
  input: SendTelegramNotificationInput
) => {
  const data: Prisma.NotificationLogUncheckedCreateInput = {
    type: input.type,
    recipientRole: input.recipientRole,
    recipientTelegramId: input.recipientTelegramId,
    status: NotificationStatus.PENDING,
    dedupeKey: input.dedupeKey
  };

  if (input.meetingRequestId) {
    data.meetingRequestId = input.meetingRequestId;
  }

  if (input.meetingId) {
    data.meetingId = input.meetingId;
  }

  try {
    return await prisma.notificationLog.create({
      data
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null;
    }

    throw error;
  }
};

const sendTelegramNotification = async (
  { prisma, bot, logger }: Pick<BackgroundJobsOptions, "prisma" | "bot" | "logger">,
  input: SendTelegramNotificationInput
) => {
  const log = await createPendingNotificationLog(prisma, input);

  if (!log) {
    return false;
  }

  if (!bot || !input.recipientTelegramId) {
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.SKIPPED,
        errorMessage: "Telegram bot or recipient is not configured"
      }
    });
    return false;
  }

  try {
    await bot.telegram.sendMessage(input.recipientTelegramId, input.text);
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date()
      }
    });
    return true;
  } catch (error) {
    logger.warn({ error, dedupeKey: input.dedupeKey }, "Failed to send background Telegram notification");
    await prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: error instanceof Error ? error.message : "Unknown Telegram error"
      }
    });
    return false;
  }
};

const buildAdminReminderText = (request: Prisma.MeetingRequestGetPayload<{ include: { user: true } }>, hours: number) => {
  const timeLabel =
    request.selectedStartAt && request.selectedEndAt
      ? formatSlotRange(request.selectedStartAt, request.selectedEndAt, request.timezone)
      : "не выбрано";

  if (hours === 2) {
    return [
      `Напоминание: ${formatRequestKind(request)} #${request.requestNumber} ожидает согласования 2 часа.`,
      "",
      `Дата и время встречи: ${timeLabel}`,
      `Пользователь: ${request.user.fullName ?? "не указано"}, ${request.user.company ?? "компания не указана"}`
    ].join("\n");
  }

  if (hours === 12) {
    return [
      `Напоминание: ${formatRequestKind(request)} #${request.requestNumber} ожидает согласования 12 часов.`,
      "",
      "Проверьте заявку, чтобы пользователь получил ответ вовремя."
    ].join("\n");
  }

  return [
    `Заявка #${request.requestNumber} просрочена по SLA.`,
    "",
    "Она не удалена, но требует решения."
  ].join("\n");
};

const sendAdminDecisionReminders = async (options: BackgroundJobsOptions, now: Date) => {
  const requests = await options.prisma.meetingRequest.findMany({
    where: {
      status: { in: pendingDecisionStatuses },
      cancelledAt: null,
      submittedAt: { not: null }
    },
    include: {
      user: true
    }
  });
  let sentCount = 0;

  for (const request of requests) {
    if (!request.submittedAt) {
      continue;
    }

    for (const hours of options.config.notifications.adminReminderAfterHours) {
      const notificationType = getAdminReminderType(hours);

      if (!notificationType || request.submittedAt.getTime() + hours * 60 * 60 * 1000 > now.getTime()) {
        continue;
      }

      if (hours === 24 && request.status !== MeetingRequestStatus.SLA_OVERDUE) {
        await options.prisma.meetingRequest.update({
          where: { id: request.id },
          data: {
            status: MeetingRequestStatus.SLA_OVERDUE,
            slaOverdueAt: now
          }
        });
        await options.prisma.statusHistory.create({
          data: {
            meetingRequestId: request.id,
            oldStatus: request.status,
            newStatus: MeetingRequestStatus.SLA_OVERDUE,
            actorRole: ActorRole.SYSTEM,
            reason: "Заявка не обработана за 24 часа"
          }
        });
      }

      const sent = await sendTelegramNotification(options, {
        meetingRequestId: request.id,
        type: notificationType,
        recipientRole: ActorRole.ADMIN,
        recipientTelegramId: options.config.telegram.adminId,
        text: buildAdminReminderText(request, hours),
        dedupeKey: `admin-reminder:${hours}h:${request.id}`
      });

      if (sent) {
        sentCount += 1;
      }
    }
  }

  return sentCount;
};

const autoCancelUnresolvedRequests = async (options: BackgroundJobsOptions, now: Date) => {
  const requests = await options.prisma.meetingRequest.findMany({
    where: {
      status: { in: pendingDecisionStatuses },
      cancelledAt: null,
      selectedStartAt: { not: null }
    },
    include: {
      user: true
    }
  });
  let cancelledCount = 0;

  for (const request of requests) {
    if (!shouldAutoCancelRequest(now, request.selectedStartAt, options.config.scheduling.meetingMinLeadHours)) {
      continue;
    }

    await options.prisma.$transaction(async (tx) => {
      await tx.meetingRequest.update({
        where: { id: request.id },
        data: {
          status: MeetingRequestStatus.DECLINED,
          declinedAt: now,
          cancelledAt: now,
          declineReason: "Автоматическая отмена: до выбранного времени осталось менее 12 часов"
        }
      });
      await tx.statusHistory.create({
        data: {
          meetingRequestId: request.id,
          oldStatus: request.status,
          newStatus: MeetingRequestStatus.DECLINED,
          actorRole: ActorRole.SYSTEM,
          reason: "Автоматическая отмена несогласованной заявки ближе минимального лага"
        }
      });
    });

    await sendTelegramNotification(options, {
      meetingRequestId: request.id,
      type: NotificationType.REQUEST_AUTO_CANCELLED,
      recipientRole: ActorRole.ADMIN,
      recipientTelegramId: options.config.telegram.adminId,
      text: `Заявка #${request.requestNumber} автоматически отменена: до выбранного времени осталось менее 12 часов, а встреча не была согласована.`,
      dedupeKey: `auto-cancel:admin:${request.id}`
    });
    await sendTelegramNotification(options, {
      meetingRequestId: request.id,
      type: NotificationType.REQUEST_AUTO_CANCELLED,
      recipientRole: ActorRole.USER,
      recipientTelegramId: request.user.telegramId,
      text: [
        "Заявка на встречу не была подтверждена вовремя и отменена автоматически.",
        "",
        "Вы можете выбрать другой доступный слот."
      ].join("\n"),
      dedupeKey: `auto-cancel:user:${request.id}`
    });
    cancelledCount += 1;
  }

  return cancelledCount;
};

const sendUserMeetingReminders = async (options: BackgroundJobsOptions, now: Date) => {
  const horizon = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const meetings = await options.prisma.meeting.findMany({
    where: {
      status: MeetingStatus.SCHEDULED,
      cancelledAt: null,
      startAt: {
        gt: now,
        lte: horizon
      }
    },
    include: {
      user: true,
      meetingRequest: true
    }
  });
  let sentCount = 0;

  for (const meeting of meetings) {
    const timeLabel = formatSlotRange(meeting.startAt, meeting.endAt, meeting.timezone);

    if (shouldSendMeetingReminder(now, meeting.startAt, 24)) {
      const sent = await sendTelegramNotification(options, {
        meetingRequestId: meeting.meetingRequestId,
        meetingId: meeting.id,
        type: NotificationType.USER_REMINDER_24H,
        recipientRole: ActorRole.USER,
        recipientTelegramId: meeting.user.telegramId,
        text: [
          "Напоминание о встрече.",
          "",
          `Дата и время: ${timeLabel}`,
          "Формат: Google Meet",
          `Ссылка: ${meeting.googleMeetLink ?? "ссылка в календарном приглашении"}`
        ].join("\n"),
        dedupeKey: `user-reminder:24h:${meeting.id}`
      });

      if (sent) {
        sentCount += 1;
      }
    }

    if (shouldSendMeetingReminder(now, meeting.startAt, 1)) {
      const sent = await sendTelegramNotification(options, {
        meetingRequestId: meeting.meetingRequestId,
        meetingId: meeting.id,
        type: NotificationType.USER_REMINDER_1H,
        recipientRole: ActorRole.USER,
        recipientTelegramId: meeting.user.telegramId,
        text: [
          "Встреча начнется через 1 час.",
          "",
          `Дата и время: ${timeLabel}`,
          `Ссылка Google Meet: ${meeting.googleMeetLink ?? "ссылка в календарном приглашении"}`
        ].join("\n"),
        dedupeKey: `user-reminder:1h:${meeting.id}`
      });

      if (sent) {
        sentCount += 1;
      }
    }
  }

  return sentCount;
};

const completePastMeetings = async (options: BackgroundJobsOptions, now: Date) => {
  const meetings = await options.prisma.meeting.findMany({
    where: {
      status: MeetingStatus.SCHEDULED,
      cancelledAt: null,
      endAt: { lte: now }
    }
  });

  for (const meeting of meetings) {
    await options.prisma.$transaction(async (tx) => {
      await tx.meeting.update({
        where: { id: meeting.id },
        data: {
          status: MeetingStatus.COMPLETED,
          completedAt: now
        }
      });
      await tx.meetingRequest.update({
        where: { id: meeting.meetingRequestId },
        data: {
          status: MeetingRequestStatus.COMPLETED,
          completedAt: now
        }
      });
      await tx.statusHistory.create({
        data: {
          meetingRequestId: meeting.meetingRequestId,
          oldStatus: MeetingRequestStatus.APPROVED,
          newStatus: MeetingRequestStatus.COMPLETED,
          actorRole: ActorRole.SYSTEM,
          reason: "Встреча завершена по времени окончания"
        }
      });
    });
  }

  return meetings.length;
};

export const runBackgroundJobsOnce = async (options: BackgroundJobsOptions, now = new Date()): Promise<JobRunStats> => {
  const stats: JobRunStats = {
    adminReminders: 0,
    autoCancelledRequests: 0,
    userReminders: 0,
    completedMeetings: 0,
    operations: null
  };

  stats.autoCancelledRequests = await autoCancelUnresolvedRequests(options, now);
  stats.adminReminders = await sendAdminDecisionReminders(options, now);
  stats.userReminders = await sendUserMeetingReminders(options, now);
  stats.completedMeetings = await completePastMeetings(options, now);
  stats.operations = await runOperationsChecksOnce(
    {
      config: options.config,
      logger: options.logger,
      prisma: options.prisma,
      telegram: options.bot?.telegram ?? null
    },
    now
  );

  await options.prisma.systemLog.create({
    data: {
      level: SystemLogLevel.INFO,
      module: "jobs",
      action: "background_jobs_run",
      message: "Background jobs run completed",
      metadata: stats
    }
  });

  return stats;
};

export const createBackgroundJobs = (options: BackgroundJobsOptions) => {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  const intervalMilliseconds = options.config.notifications.backgroundJobsIntervalMinutes * 60 * 1000;

  const run = async () => {
    if (running) {
      options.logger.warn("Background jobs run skipped because previous run is still active");
      return;
    }

    running = true;
    try {
      const stats = await runBackgroundJobsOnce(options);
      options.logger.info({ stats }, "Background jobs run completed");
    } catch (error) {
      await recordTechnicalError(
        {
          config: options.config,
          logger: options.logger,
          prisma: options.prisma,
          telegram: options.bot?.telegram ?? null
        },
        {
          module: "jobs",
          action: "background_jobs_run",
          message: "Background jobs run failed",
          error,
          dedupeKey: `jobs:background-run-failed:${new Date().toISOString().slice(0, 10)}`
        }
      );
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer || options.config.app.nodeEnv === "test") {
        return;
      }

      timer = setInterval(() => {
        void run();
      }, intervalMilliseconds);
      options.logger.info(
        { intervalMinutes: options.config.notifications.backgroundJobsIntervalMinutes },
        "Background jobs scheduler started"
      );
    },
    stop() {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
      options.logger.info("Background jobs scheduler stopped");
    },
    run
  };
};
