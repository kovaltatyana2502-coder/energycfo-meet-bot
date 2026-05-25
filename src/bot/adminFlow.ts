import {
  ActorRole,
  MeetingRequestStatus,
  MeetingStatus,
  NotificationStatus,
  NotificationType,
  Prisma,
  type PrismaClient
} from "@prisma/client";
import type { Context, Markup } from "telegraf";

import {
  adminMenuKeyboard,
  adminRequestActionsKeyboard,
  adminRequestListKeyboard,
  declineReasonKeyboard
} from "./keyboards.js";
import { createCalendarMeetingEvent } from "../calendar/googleCalendar.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import { formatSlotRange } from "../scheduling/availability.js";

type ReplyMarkup = ReturnType<typeof Markup.keyboard>;

type TextContext = Context & {
  message: {
    text: string;
  };
};

type AdminStep = "admin_decline_reason" | "admin_custom_decline_reason";

type AdminSessionData = {
  requestNumber?: number;
};

type AdminRequest = Prisma.MeetingRequestGetPayload<{
  include: {
    user: true;
    contactPreferences: true;
    meeting: true;
  };
}>;

type AdminAction = "view" | "approve" | "decline" | "alternative";

const statusLabels: Record<MeetingRequestStatus, string> = {
  DRAFT: "Черновик",
  PENDING_APPROVAL: "Ожидает согласования",
  APPROVED: "Согласована",
  DECLINED: "Отклонена",
  CANCELLED_BY_USER: "Отменена",
  RESCHEDULE_PENDING: "Ожидает согласования переноса",
  RESCHEDULED: "Перенесена",
  SLA_OVERDUE: "Требует решения",
  COMPLETED: "Завершена"
};

const actionPatterns: Array<[AdminAction, RegExp]> = [
  ["view", /^Заявка #(\d+)$/],
  ["approve", /^Согласовать #(\d+)$/],
  ["decline", /^Отклонить #(\d+)$/],
  ["alternative", /^Предложить другое время #(\d+)$/]
];

export const parseAdminRequestAction = (value: string): { action: AdminAction; requestNumber: number } | null => {
  const text = value.trim();

  for (const [action, pattern] of actionPatterns) {
    const match = pattern.exec(text);

    if (match?.[1]) {
      return {
        action,
        requestNumber: Number.parseInt(match[1], 10)
      };
    }
  }

  return null;
};

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");

const getSessionData = (data: unknown): AdminSessionData => {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  return data as AdminSessionData;
};

const formatTelegramProfile = (request: AdminRequest) =>
  request.user.telegramUsername ? `@${request.user.telegramUsername}` : `ID ${request.user.telegramId}`;

const formatContactPreference = (request: AdminRequest) => {
  const contactPreference = request.contactPreferences.at(0);

  if (!contactPreference) {
    return "не указан";
  }

  return `${contactPreference.channel}${contactPreference.value ? `: ${contactPreference.value}` : ""}`;
};

const formatRequestTime = (request: AdminRequest) =>
  request.selectedStartAt && request.selectedEndAt
    ? formatSlotRange(request.selectedStartAt, request.selectedEndAt, request.timezone)
    : "не выбрано";

const buildRequestCard = (request: AdminRequest) =>
  [
    `Заявка #${request.requestNumber}`,
    `Статус: ${statusLabels[request.status]}`,
    `Тема: ${request.topicText ?? "не указана"}`,
    `ФИО: ${request.user.fullName ?? "не указано"}`,
    `Компания: ${request.user.company ?? "не указана"}`,
    `Должность: ${request.user.position ?? "не указана"}`,
    `Email: ${request.user.email ?? "не указан"}`,
    `Telegram: ${formatTelegramProfile(request)}`,
    `Способ связи: ${formatContactPreference(request)}`,
    `Дата и время: ${formatRequestTime(request)}`,
    `Комментарий: ${request.comment ?? "не указан"}`
  ].join("\n");

export const createAdminFlow = (config: AppConfig, logger: AppLogger, prisma: PrismaClient) => {
  const isAdmin = (ctx: Context) => String(ctx.from?.id) === config.telegram.adminId;

  const reply = async (ctx: Context, text: string, keyboard?: ReplyMarkup) => {
    await ctx.reply(text, keyboard);
  };

  const assertAdmin = async (ctx: Context) => {
    if (isAdmin(ctx)) {
      return true;
    }

    await reply(ctx, "Не удалось выполнить действие.", undefined);
    return false;
  };

  const panel = async (ctx: Context) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    await reply(ctx, "Админ-панель.\n\nВыберите раздел.", adminMenuKeyboard());
  };

  const getRequestByNumber = async (requestNumber: number) =>
    prisma.meetingRequest.findUnique({
      where: { requestNumber },
      include: {
        user: true,
        contactPreferences: true,
        meeting: true
      }
    });

  const showNewRequests = async (ctx: Context) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    const requests = await prisma.meetingRequest.findMany({
      where: {
        status: MeetingRequestStatus.PENDING_APPROVAL,
        cancelledAt: null
      },
      include: {
        user: true,
        contactPreferences: true,
        meeting: true
      },
      orderBy: [{ submittedAt: "asc" }, { createdAt: "asc" }],
      take: 10
    });

    if (requests.length === 0) {
      await reply(ctx, "Новых заявок на согласование нет.", adminMenuKeyboard());
      return;
    }

    const lines = requests.flatMap((request) => [
      `#${request.requestNumber} | ${request.user.fullName ?? "ФИО не указано"}`,
      `${request.topicText ?? "Тема не указана"}`,
      `${formatRequestTime(request)}`,
      ""
    ]);

    await reply(
      ctx,
      ["Новые заявки на согласование:", "", ...lines, "Выберите заявку для просмотра."].join("\n").trim(),
      adminRequestListKeyboard(requests.map((request) => request.requestNumber))
    );
  };

  const showRequest = async (ctx: Context, requestNumber: number) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    const request = await getRequestByNumber(requestNumber);

    if (!request) {
      await reply(ctx, `Заявка #${requestNumber} не найдена.`, adminMenuKeyboard());
      return;
    }

    await reply(ctx, `${buildRequestCard(request)}\n\nВыберите действие.`, adminRequestActionsKeyboard(requestNumber));
  };

  const sendUserMessage = async (ctx: Context, request: AdminRequest, text: string) => {
    const notificationType =
      request.status === MeetingRequestStatus.DECLINED ? NotificationType.REQUEST_DECLINED : NotificationType.REQUEST_APPROVED;

    try {
      await ctx.telegram.sendMessage(request.user.telegramId, text);
      await prisma.notificationLog.create({
        data: {
          meetingRequestId: request.id,
          type: notificationType,
          recipientRole: ActorRole.USER,
          recipientTelegramId: request.user.telegramId,
          status: NotificationStatus.SENT,
          sentAt: new Date()
        }
      });
    } catch (error) {
      logger.warn({ error, requestId: request.id }, "Failed to send admin decision notification to user");
      await prisma.notificationLog.create({
        data: {
          meetingRequestId: request.id,
          type: notificationType,
          recipientRole: ActorRole.USER,
          recipientTelegramId: request.user.telegramId,
          status: NotificationStatus.FAILED,
          errorMessage: error instanceof Error ? error.message : "Unknown Telegram error"
        }
      });
    }
  };

  const approveRequest = async (ctx: Context, requestNumber: number) => {
    if (!(await assertAdmin(ctx)) || !ctx.from) {
      return;
    }

    const request = await getRequestByNumber(requestNumber);

    if (!request) {
      await reply(ctx, `Заявка #${requestNumber} не найдена.`, adminMenuKeyboard());
      return;
    }

    if (request.status !== MeetingRequestStatus.PENDING_APPROVAL) {
      await reply(ctx, `Заявка #${requestNumber} уже не ожидает согласования.`, adminMenuKeyboard());
      return;
    }

    if (!request.selectedStartAt || !request.selectedEndAt) {
      await reply(ctx, `У заявки #${requestNumber} не выбрано время. Согласование невозможно.`, adminMenuKeyboard());
      return;
    }

    const selectedStartAt = request.selectedStartAt;
    const selectedEndAt = request.selectedEndAt;
    let calendarEvent;

    try {
      calendarEvent = await createCalendarMeetingEvent(config, {
        id: request.id,
        requestNumber: request.requestNumber,
        topicText: request.topicText,
        comment: request.comment,
        selectedStartAt,
        selectedEndAt,
        timezone: request.timezone,
        user: {
          fullName: request.user.fullName,
          company: request.user.company,
          position: request.user.position,
          email: request.user.email,
          telegramUsername: request.user.telegramUsername,
          telegramId: request.user.telegramId
        }
      });
    } catch (error) {
      logger.error({ error, requestId: request.id }, "Failed to create Google Calendar event");
      await reply(
        ctx,
        [
          `Не удалось создать событие в Google Calendar по заявке #${requestNumber}.`,
          "",
          "Заявка не потеряна и остается в статусе «Ожидает согласования». Проверьте интеграцию с календарем или повторите действие позже."
        ].join("\n"),
        adminRequestActionsKeyboard(requestNumber)
      );
      return;
    }

    const approvedRequest = await prisma.$transaction(async (tx) => {
      await tx.meeting.upsert({
        where: { meetingRequestId: request.id },
        update: {
          status: MeetingStatus.SCHEDULED,
          startAt: selectedStartAt,
          endAt: selectedEndAt,
          timezone: request.timezone,
          googleCalendarId: calendarEvent.calendarId,
          googleEventId: calendarEvent.eventId,
          googleMeetLink: calendarEvent.meetLink,
          cancelledAt: null
        },
        create: {
          meetingRequestId: request.id,
          userId: request.userId,
          status: MeetingStatus.SCHEDULED,
          startAt: selectedStartAt,
          endAt: selectedEndAt,
          timezone: request.timezone,
          googleCalendarId: calendarEvent.calendarId,
          googleEventId: calendarEvent.eventId,
          googleMeetLink: calendarEvent.meetLink
        }
      });

      const updatedRequest = await tx.meetingRequest.update({
        where: { id: request.id },
        data: {
          status: MeetingRequestStatus.APPROVED,
          approvedAt: new Date()
        },
        include: {
          user: true,
          contactPreferences: true,
          meeting: true
        }
      });

      await tx.statusHistory.create({
        data: {
          meetingRequestId: request.id,
          oldStatus: request.status,
          newStatus: MeetingRequestStatus.APPROVED,
          actorRole: ActorRole.ADMIN,
          actorTelegramId: String(ctx.from?.id),
          reason: "Администратор согласовал заявку"
        }
      });

      return updatedRequest;
    });

    await sendUserMessage(
      ctx,
      approvedRequest,
      [
        "Ваша встреча согласована.",
        "",
        `Дата и время: ${formatRequestTime(approvedRequest)}`,
        `Формат: Google Meet`,
        `Ссылка: ${calendarEvent.meetLink ?? "ссылка будет доступна в календарном приглашении"}`,
        "",
        `Календарное приглашение отправлено на email: ${approvedRequest.user.email ?? "не указан"}`
      ].join("\n")
    );

    await reply(
      ctx,
      [
        `Заявка #${requestNumber} согласована.`,
        "",
        "Событие создано в Google Calendar, пользователю отправлено уведомление.",
        calendarEvent.meetLink ? `Google Meet: ${calendarEvent.meetLink}` : "Google Meet: ссылка будет доступна в событии календаря."
      ].join("\n"),
      adminMenuKeyboard()
    );
  };

  const askDeclineReason = async (ctx: Context, requestNumber: number) => {
    if (!(await assertAdmin(ctx)) || !ctx.from) {
      return;
    }

    const request = await getRequestByNumber(requestNumber);

    if (!request) {
      await reply(ctx, `Заявка #${requestNumber} не найдена.`, adminMenuKeyboard());
      return;
    }

    if (request.status !== MeetingRequestStatus.PENDING_APPROVAL) {
      await reply(ctx, `Заявка #${requestNumber} уже не ожидает согласования.`, adminMenuKeyboard());
      return;
    }

    await prisma.botSession.upsert({
      where: { telegramId: String(ctx.from.id) },
      update: {
        currentStep: "admin_decline_reason",
        activeMeetingRequestId: request.id,
        data: { requestNumber }
      },
      create: {
        telegramId: String(ctx.from.id),
        currentStep: "admin_decline_reason",
        activeMeetingRequestId: request.id,
        data: { requestNumber }
      }
    });

    await reply(
      ctx,
      "Укажите причину отказа.\n\nВ бизнес-среде отказ должен быть понятным для пользователя.",
      declineReasonKeyboard()
    );
  };

  const declineRequest = async (ctx: Context, reason: string) => {
    if (!(await assertAdmin(ctx)) || !ctx.from) {
      return;
    }

    const session = await prisma.botSession.findUnique({ where: { telegramId: String(ctx.from.id) } });

    if (!session?.activeMeetingRequestId) {
      await reply(ctx, "Заявка для отказа не выбрана.", adminMenuKeyboard());
      return;
    }

    const request = await prisma.meetingRequest.findUnique({
      where: { id: session.activeMeetingRequestId },
      include: {
        user: true,
        contactPreferences: true,
        meeting: true
      }
    });

    if (!request) {
      await prisma.botSession.deleteMany({ where: { telegramId: String(ctx.from.id) } });
      await reply(ctx, "Заявка не найдена.", adminMenuKeyboard());
      return;
    }

    if (request.status !== MeetingRequestStatus.PENDING_APPROVAL) {
      await prisma.botSession.deleteMany({ where: { telegramId: String(ctx.from.id) } });
      await reply(ctx, `Заявка #${request.requestNumber} уже не ожидает согласования.`, adminMenuKeyboard());
      return;
    }

    const declinedRequest = await prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.meetingRequest.update({
        where: { id: request.id },
        data: {
          status: MeetingRequestStatus.DECLINED,
          declineReason: reason,
          declinedAt: new Date()
        },
        include: {
          user: true,
          contactPreferences: true,
          meeting: true
        }
      });

      await tx.statusHistory.create({
        data: {
          meetingRequestId: request.id,
          oldStatus: request.status,
          newStatus: MeetingRequestStatus.DECLINED,
          actorRole: ActorRole.ADMIN,
          actorTelegramId: String(ctx.from?.id),
          reason
        }
      });

      await tx.botSession.deleteMany({ where: { telegramId: String(ctx.from?.id) } });

      return updatedRequest;
    });

    await sendUserMessage(
      ctx,
      declinedRequest,
      [
        "Заявка на встречу отклонена.",
        "",
        `Причина: ${reason}`,
        "",
        "При необходимости вы можете создать новую заявку с другой темой или временем."
      ].join("\n")
    );

    await reply(
      ctx,
      [`Заявка #${request.requestNumber} отклонена.`, "", "Причина отправлена пользователю."].join("\n"),
      adminMenuKeyboard()
    );
  };

  const showActiveMeetings = async (ctx: Context) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    const meetings = await prisma.meeting.findMany({
      where: {
        status: MeetingStatus.SCHEDULED,
        cancelledAt: null
      },
      include: {
        meetingRequest: {
          include: {
            user: true,
            contactPreferences: true,
            meeting: true
          }
        }
      },
      orderBy: { startAt: "asc" },
      take: 10
    });

    if (meetings.length === 0) {
      await reply(ctx, "Активных встреч пока нет.", adminMenuKeyboard());
      return;
    }

    const lines = meetings.flatMap((meeting) => [
      `#${meeting.meetingRequest.requestNumber} | ${meeting.meetingRequest.user.fullName ?? "ФИО не указано"}`,
      formatRequestTime(meeting.meetingRequest),
      ""
    ]);

    await reply(ctx, ["Активные встречи:", "", ...lines].join("\n").trim(), adminMenuKeyboard());
  };

  const showScheduleSettings = async (ctx: Context) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    const settings = await prisma.availabilitySettings.findFirst({
      where: { isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    await reply(
      ctx,
      [
        "Текущие настройки расписания:",
        "",
        "Рабочие дни: Пн-Пт",
        `Рабочее время: ${settings?.workingHoursStart ?? config.scheduling.workingHoursStart}-${settings?.workingHoursEnd ?? config.scheduling.workingHoursEnd} МСК`,
        `Длительность встречи: ${settings?.meetingDurationMinutes ?? config.scheduling.meetingDurationMinutes} минут`,
        `Буфер: ${settings?.meetingBufferMinutes ?? config.scheduling.meetingBufferMinutes} минут`,
        `Минимальный лаг: ${settings?.meetingMinLeadHours ?? config.scheduling.meetingMinLeadHours} часов`,
        `Лимит встреч: ${settings?.meetingDailyLimit ?? config.scheduling.meetingDailyLimit} в день`,
        `Горизонт пользователя: ${settings?.userBookingHorizonMonths ?? config.scheduling.userBookingHorizonMonths} месяца`,
        `Горизонт администратора: ${settings?.adminAvailabilityHorizonMonths ?? config.scheduling.adminAvailabilityHorizonMonths} месяца`,
        "",
        "Редактирование настроек будет добавлено отдельным подэтапом."
      ].join("\n"),
      adminMenuKeyboard()
    );
  };

  const showStats = async (ctx: Context) => {
    if (!(await assertAdmin(ctx))) {
      return;
    }

    const [startedCount, submittedCount, approvedCount, declinedCount] = await Promise.all([
      prisma.meetingRequest.count(),
      prisma.meetingRequest.count({ where: { submittedAt: { not: null } } }),
      prisma.meetingRequest.count({ where: { status: MeetingRequestStatus.APPROVED } }),
      prisma.meetingRequest.count({ where: { status: MeetingRequestStatus.DECLINED } })
    ]);

    await reply(
      ctx,
      [
        "Статистика за весь период:",
        "",
        `Начатые заявки: ${startedCount}`,
        `Отправленные заявки: ${submittedCount}`,
        `Согласованные встречи: ${approvedCount}`,
        `Отказы: ${declinedCount}`
      ].join("\n"),
      adminMenuKeyboard()
    );
  };

  const handleText = async (ctx: TextContext): Promise<boolean> => {
    if (!isAdmin(ctx)) {
      return false;
    }

    const text = normalizeText(ctx.message.text);

    if (text === "Админ-панель" || text === "Назад") {
      await panel(ctx);
      return true;
    }

    if (text === "Новые заявки") {
      await showNewRequests(ctx);
      return true;
    }

    if (text === "Активные встречи") {
      await showActiveMeetings(ctx);
      return true;
    }

    if (text === "Настройки расписания") {
      await showScheduleSettings(ctx);
      return true;
    }

    if (text === "Статистика") {
      await showStats(ctx);
      return true;
    }

    if (text === "Заявки на перенос" || text === "Недоступные даты") {
      await reply(ctx, "Этот раздел будет добавлен следующим подэтапом.", adminMenuKeyboard());
      return true;
    }

    const session = ctx.from
      ? await prisma.botSession.findUnique({ where: { telegramId: String(ctx.from.id) } })
      : null;

    if (session?.currentStep === "admin_decline_reason" || session?.currentStep === "admin_custom_decline_reason") {
      if (text === "Отменить") {
        await prisma.botSession.deleteMany({ where: { telegramId: String(ctx.from?.id) } });
        await reply(ctx, "Отказ отменен.", adminMenuKeyboard());
        return true;
      }

      if ((session.currentStep as AdminStep) === "admin_decline_reason" && text === "Другое") {
        const sessionData = getSessionData(session.data);
        await prisma.botSession.update({
          where: { telegramId: String(ctx.from?.id) },
          data: {
            currentStep: "admin_custom_decline_reason",
            data: sessionData
          }
        });
        await reply(ctx, "Напишите причину отказа.");
        return true;
      }

      if (!text) {
        await reply(ctx, "Причина отказа обязательна.", declineReasonKeyboard());
        return true;
      }

      await declineRequest(ctx, text);
      return true;
    }

    const parsedAction = parseAdminRequestAction(text);

    if (!parsedAction) {
      return false;
    }

    if (parsedAction.action === "view") {
      await showRequest(ctx, parsedAction.requestNumber);
      return true;
    }

    if (parsedAction.action === "approve") {
      await approveRequest(ctx, parsedAction.requestNumber);
      return true;
    }

    if (parsedAction.action === "decline") {
      await askDeclineReason(ctx, parsedAction.requestNumber);
      return true;
    }

    await reply(
      ctx,
      "Предложение другого времени будет добавлено отдельным подэтапом вместе с выбором до 3 альтернативных слотов.",
      adminMenuKeyboard()
    );
    return true;
  };

  return {
    panel,
    showNewRequests,
    handleText
  };
};
