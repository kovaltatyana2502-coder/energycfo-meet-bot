import {
  ActorRole,
  ContactChannel,
  MeetingRequestStatus,
  MeetingTopic,
  PrismaClient
} from "@prisma/client";
import type { Context, Markup } from "telegraf";

import {
  bookingConfirmationKeyboard,
  contactChannelKeyboard,
  consentKeyboard,
  dateSelectionKeyboard,
  mainMenuKeyboard,
  slotSelectionKeyboard,
  topicKeyboard
} from "./keyboards.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import {
  dateKeyFromUtc,
  formatDateLabel,
  formatSlotRange,
  getAvailableDates,
  getAvailableSlotsForDate,
  getSchedulingContext,
  parseDateLabel,
  type AvailableDate
} from "../scheduling/availability.js";

type ReplyMarkup = ReturnType<typeof Markup.keyboard>;

type TextContext = Context & {
  message: {
    text: string;
  };
};

type BookingStep =
  | "consent"
  | "topic"
  | "custom_topic"
  | "full_name"
  | "company"
  | "position"
  | "email"
  | "comment"
  | "contact_channel"
  | "contact_value"
  | "date"
  | "slot"
  | "confirm";

type SessionData = {
  pendingContactChannel?: ContactChannel;
  selectedDate?: string;
  datePage?: number;
};

type TopicChoice = {
  topic: MeetingTopic;
  topicText: string;
};

const topicChoices = new Map<string, TopicChoice>([
  ["Корпоративные функции", { topic: MeetingTopic.CORPORATE_FUNCTIONS, topicText: "Корпоративные функции" }],
  ["Тарифная кампания", { topic: MeetingTopic.TARIFF_CAMPAIGN, topicText: "Тарифная кампания" }],
  ["Комплексный подход", { topic: MeetingTopic.INTEGRATED_APPROACH, topicText: "Комплексный подход" }]
]);

const contactChannelChoices = new Map<string, ContactChannel>([
  ["Telegram", ContactChannel.TELEGRAM],
  ["Email", ContactChannel.EMAIL],
  ["Телефон", ContactChannel.PHONE],
  ["WhatsApp", ContactChannel.WHATSAPP],
  ["Другое", ContactChannel.OTHER]
]);

const DATE_PAGE_SIZE = 12;

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

export const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ");

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

export const parseTopicChoice = (value: string) => topicChoices.get(normalizeText(value));

export const parseContactChannel = (value: string) => contactChannelChoices.get(normalizeText(value));

export const createBookingFlow = (config: AppConfig, logger: AppLogger, prisma: PrismaClient) => {
  const isAdmin = (ctx: Context) => String(ctx.from?.id) === config.telegram.adminId;

  const ensureTelegramUser = async (ctx: Context) => {
    if (!ctx.from) {
      throw new Error("Telegram user is missing in update");
    }

    return prisma.user.upsert({
      where: {
        telegramId: String(ctx.from.id)
      },
      update: {
        telegramUsername: ctx.from.username ?? null,
        telegramFirstName: ctx.from.first_name ?? null,
        telegramLastName: ctx.from.last_name ?? null
      },
      create: {
        telegramId: String(ctx.from.id),
        telegramUsername: ctx.from.username ?? null,
        telegramFirstName: ctx.from.first_name ?? null,
        telegramLastName: ctx.from.last_name ?? null
      }
    });
  };

  const getSessionData = (data: unknown): SessionData => {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return {};
    }

    return data as SessionData;
  };

  const setSession = async (
    telegramId: string,
    userId: string,
    currentStep: BookingStep,
    activeMeetingRequestId: string,
    data: SessionData = {}
  ) =>
    prisma.botSession.upsert({
      where: { telegramId },
      update: {
        userId,
        currentStep,
        activeMeetingRequestId,
        data
      },
      create: {
        telegramId,
        userId,
        currentStep,
        activeMeetingRequestId,
        data
      }
    });

  const reply = async (ctx: Context, text: string, keyboard?: ReplyMarkup) => {
    await ctx.reply(text, keyboard);
  };

  const getActiveRequest = async (activeMeetingRequestId: string) =>
    prisma.meetingRequest.findUnique({
      where: { id: activeMeetingRequestId },
      include: {
        user: true,
        contactPreferences: true
      }
    });

  const getSlotsForDate = async (dateISO: string) => {
    const schedulingContext = await getSchedulingContext(prisma, config);

    return getAvailableSlotsForDate({
      ...schedulingContext,
      dateISO
    });
  };

  const getDatePage = (dates: AvailableDate[], page: number) => {
    const lastPage = Math.max(Math.ceil(dates.length / DATE_PAGE_SIZE) - 1, 0);
    const safePage = Math.min(Math.max(page, 0), lastPage);
    const startIndex = safePage * DATE_PAGE_SIZE;

    return {
      safePage,
      items: dates.slice(startIndex, startIndex + DATE_PAGE_SIZE),
      hasPreviousPage: safePage > 0,
      hasNextPage: startIndex + DATE_PAGE_SIZE < dates.length
    };
  };

  const showAvailableDates = async (
    ctx: Context,
    telegramId: string,
    userId: string,
    activeMeetingRequestId: string,
    page = 0
  ) => {
    const schedulingContext = await getSchedulingContext(prisma, config);
    const dates = getAvailableDates(schedulingContext);

    if (dates.length === 0) {
      await prisma.botSession.deleteMany({ where: { activeMeetingRequestId } });
      await reply(
        ctx,
        [
          "Сейчас нет доступных дат для записи на ближайшие 2 месяца.",
          "",
          "Черновик заявки сохранен. Попробуйте выбрать время позже или свяжитесь напрямую по каналу, где получили ссылку на бота."
        ].join("\n"),
        mainMenuKeyboard(isAdmin(ctx))
      );
      return;
    }

    const datePage = getDatePage(dates, page);
    await setSession(telegramId, userId, "date", activeMeetingRequestId, { datePage: datePage.safePage });

    await reply(
      ctx,
      [
        "Выберите дату встречи.",
        "",
        "Показываются доступные даты на ближайшие 2 месяца. Время указано по МСК.",
        `Показано дат: ${datePage.items.length} из ${dates.length}.`
      ].join("\n"),
      dateSelectionKeyboard(
        datePage.items.map((date) => date.label),
        {
          hasPreviousPage: datePage.hasPreviousPage,
          hasNextPage: datePage.hasNextPage
        }
      )
    );
  };

  const showSlotsForDate = async (
    ctx: Context,
    telegramId: string,
    userId: string,
    activeMeetingRequestId: string,
    dateISO: string,
    datePage = 0
  ) => {
    const schedulingContext = await getSchedulingContext(prisma, config);
    const slots = getAvailableSlotsForDate({
      ...schedulingContext,
      dateISO
    });

    if (slots.length === 0) {
      await setSession(telegramId, userId, "date", activeMeetingRequestId, { datePage });
      await reply(ctx, "На эту дату свободных слотов уже нет. Выберите другую дату.");
      await showAvailableDates(ctx, telegramId, userId, activeMeetingRequestId, datePage);
      return;
    }

    await setSession(telegramId, userId, "slot", activeMeetingRequestId, { selectedDate: dateISO, datePage });
    await reply(
      ctx,
      `Выберите свободное время на ${formatDateLabel(dateISO, schedulingContext.settings.timezone)}.`,
      slotSelectionKeyboard(slots.map((slot) => slot.startLabel))
    );
  };

  const formatContactPreference = (request: Awaited<ReturnType<typeof getActiveRequest>>) => {
    const contactPreference = request?.contactPreferences.at(0);

    if (!contactPreference) {
      return "не указан";
    }

    return `${contactPreference.channel}${contactPreference.value ? `: ${contactPreference.value}` : ""}`;
  };

  const buildRequestSummaryLines = (request: NonNullable<Awaited<ReturnType<typeof getActiveRequest>>>) => [
    `Заявка: #${request.requestNumber}`,
    `Статус: ${statusLabels[request.status]}`,
    `Тема: ${request.topicText ?? "не указана"}`,
    `ФИО: ${request.user.fullName ?? "не указано"}`,
    `Компания: ${request.user.company ?? "не указана"}`,
    `Должность: ${request.user.position ?? "не указана"}`,
    `Email: ${request.user.email ?? "не указан"}`,
    `Способ связи: ${formatContactPreference(request)}`,
    `Комментарий: ${request.comment ?? "не указан"}`,
    `Время: ${
      request.selectedStartAt && request.selectedEndAt
        ? formatSlotRange(request.selectedStartAt, request.selectedEndAt, request.timezone)
        : "не выбрано"
    }`
  ];

  const showSlotConfirmation = async (ctx: Context, activeMeetingRequestId: string) => {
    const request = await getActiveRequest(activeMeetingRequestId);

    if (!request) {
      await reply(ctx, "Черновик заявки не найден. Начните запись заново.", mainMenuKeyboard(isAdmin(ctx)));
      return;
    }

    await reply(
      ctx,
      ["Проверьте данные заявки перед отправкой на согласование.", "", ...buildRequestSummaryLines(request)].join("\n"),
      bookingConfirmationKeyboard()
    );
  };

  const notifyAdminAboutRequest = async (
    ctx: Context,
    request: NonNullable<Awaited<ReturnType<typeof getActiveRequest>>>
  ) => {
    if (!config.telegram.adminId || config.telegram.adminId === "replace_me") {
      return;
    }

    await ctx.telegram.sendMessage(
      config.telegram.adminId,
      [
        `Новая заявка на встречу #${request.requestNumber}`,
        "",
        ...buildRequestSummaryLines(request),
        "",
        "Кнопки согласования будут добавлены на следующем этапе админ-сценария."
      ].join("\n")
    );
  };

  const start = async (ctx: Context) => {
    const user = await ensureTelegramUser(ctx);
    const telegramId = user.telegramId;
    const existingSession = await prisma.botSession.findUnique({ where: { telegramId } });

    if (existingSession?.activeMeetingRequestId) {
      await prisma.meetingRequest.updateMany({
        where: {
          id: existingSession.activeMeetingRequestId,
          status: MeetingRequestStatus.DRAFT,
          cancelledAt: null
        },
        data: {
          cancelledAt: new Date()
        }
      });
    }

    const meetingRequest = await prisma.meetingRequest.create({
      data: {
        userId: user.id,
        status: MeetingRequestStatus.DRAFT
      }
    });

    await setSession(telegramId, user.id, "consent", meetingRequest.id);

    await reply(
      ctx,
      [
        "Перед записью нужно подтвердить согласие на обработку данных, которые потребуются для организации встречи: ФИО, компания, должность, email, тема встречи, комментарий и выбранный способ связи.",
        "",
        "Точный текст согласия и ссылка на политику обработки персональных данных будут добавлены перед промышленным запуском."
      ].join("\n"),
      consentKeyboard()
    );
  };

  const cancel = async (ctx: Context) => {
    if (!ctx.from) {
      return;
    }

    const telegramId = String(ctx.from.id);
    const session = await prisma.botSession.findUnique({ where: { telegramId } });

    if (session?.activeMeetingRequestId) {
      await prisma.meetingRequest.updateMany({
        where: {
          id: session.activeMeetingRequestId,
          status: MeetingRequestStatus.DRAFT
        },
        data: {
          cancelledAt: new Date()
        }
      });
    }

    await prisma.botSession.deleteMany({ where: { telegramId } });
    await reply(ctx, "Действие отменено.", mainMenuKeyboard(isAdmin(ctx)));
  };

  const myMeetings = async (ctx: Context) => {
    const user = await ensureTelegramUser(ctx);
    const requests = await prisma.meetingRequest.findMany({
      where: {
        userId: user.id,
        cancelledAt: null,
        status: {
          in: [
            MeetingRequestStatus.DRAFT,
            MeetingRequestStatus.PENDING_APPROVAL,
            MeetingRequestStatus.APPROVED,
            MeetingRequestStatus.RESCHEDULE_PENDING,
            MeetingRequestStatus.SLA_OVERDUE
          ]
        }
      },
      orderBy: { createdAt: "desc" },
      take: 5
    });

    if (requests.length === 0) {
      await reply(ctx, "У вас пока нет активных заявок или встреч.", mainMenuKeyboard(isAdmin(ctx)));
      return;
    }

    const lines = requests.flatMap((request) => [
      `#${request.requestNumber}`,
      `Статус: ${statusLabels[request.status]}`,
      `Тема: ${request.topicText ?? "не указана"}`,
      `Время: ${
        request.selectedStartAt && request.selectedEndAt
          ? formatSlotRange(request.selectedStartAt, request.selectedEndAt, request.timezone)
          : "не выбрано"
      }`,
      ""
    ]);

    await reply(ctx, ["Ваши активные заявки и встречи:", "", ...lines].join("\n").trim(), mainMenuKeyboard(isAdmin(ctx)));
  };

  const handleText = async (ctx: TextContext) => {
    if (!ctx.from) {
      return;
    }

    const text = normalizeText(ctx.message.text);

    if (text === "Назначить встречу") {
      await start(ctx);
      return;
    }

    if (text === "Мои встречи") {
      await myMeetings(ctx);
      return;
    }

    if (text === "Отменить" || text === "Не согласен") {
      await cancel(ctx);
      return;
    }

    const telegramId = String(ctx.from.id);
    const session = await prisma.botSession.findUnique({ where: { telegramId } });

    if (!session?.activeMeetingRequestId) {
      return;
    }

    const user = await ensureTelegramUser(ctx);
    const activeMeetingRequestId = session.activeMeetingRequestId;
    const sessionData = getSessionData(session.data);

    switch (session.currentStep as BookingStep) {
      case "consent": {
        if (text !== "Согласен и продолжить") {
          await reply(ctx, "Чтобы продолжить, подтвердите согласие или отмените запись.", consentKeyboard());
          return;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { consentGivenAt: new Date() }
        });
        await setSession(telegramId, user.id, "topic", activeMeetingRequestId);
        await reply(ctx, "Выберите тему встречи.", topicKeyboard());
        return;
      }

      case "topic": {
        if (text === "Другое") {
          await setSession(telegramId, user.id, "custom_topic", activeMeetingRequestId);
          await reply(ctx, "Кратко опишите тему встречи.");
          return;
        }

        const topicChoice = parseTopicChoice(text);
        if (!topicChoice) {
          await reply(ctx, "Выберите тему из списка.", topicKeyboard());
          return;
        }

        await prisma.meetingRequest.update({
          where: { id: activeMeetingRequestId },
          data: topicChoice
        });
        await setSession(telegramId, user.id, "full_name", activeMeetingRequestId);
        await reply(ctx, "Укажите ФИО.");
        return;
      }

      case "custom_topic": {
        if (text.length === 0) {
          await reply(ctx, "Пожалуйста, укажите тему встречи.");
          return;
        }
        if (text.length > 300) {
          await reply(ctx, "Тема слишком длинная. Сформулируйте короче, до 300 символов.");
          return;
        }

        await prisma.meetingRequest.update({
          where: { id: activeMeetingRequestId },
          data: {
            topic: MeetingTopic.OTHER,
            topicText: text
          }
        });
        await setSession(telegramId, user.id, "full_name", activeMeetingRequestId);
        await reply(ctx, "Укажите ФИО.");
        return;
      }

      case "full_name": {
        if (!text) {
          await reply(ctx, "ФИО обязательно для заявки. Пожалуйста, укажите ФИО.");
          return;
        }

        await prisma.user.update({ where: { id: user.id }, data: { fullName: text } });
        await setSession(telegramId, user.id, "company", activeMeetingRequestId);
        await reply(ctx, "Укажите компанию.");
        return;
      }

      case "company": {
        if (!text) {
          await reply(ctx, "Компания обязательна для заявки. Пожалуйста, укажите название компании.");
          return;
        }

        await prisma.user.update({ where: { id: user.id }, data: { company: text } });
        await setSession(telegramId, user.id, "position", activeMeetingRequestId);
        await reply(ctx, "Укажите вашу должность.");
        return;
      }

      case "position": {
        if (!text) {
          await reply(ctx, "Должность обязательна для заявки. Пожалуйста, укажите должность.");
          return;
        }

        await prisma.user.update({ where: { id: user.id }, data: { position: text } });
        await setSession(telegramId, user.id, "email", activeMeetingRequestId);
        await reply(ctx, "Укажите email для календарного приглашения.");
        return;
      }

      case "email": {
        if (!isValidEmail(text)) {
          await reply(ctx, "Похоже, email указан некорректно. Проверьте адрес и отправьте еще раз.");
          return;
        }

        await prisma.user.update({ where: { id: user.id }, data: { email: text } });
        await setSession(telegramId, user.id, "comment", activeMeetingRequestId);
        await reply(ctx, "Кратко опишите вопрос или задачу, которую хотите обсудить.");
        return;
      }

      case "comment": {
        if (!text) {
          await reply(ctx, "Комментарий нужен, чтобы оценить контекст встречи. Напишите, пожалуйста, 1-2 предложения.");
          return;
        }

        await prisma.meetingRequest.update({
          where: { id: activeMeetingRequestId },
          data: { comment: text }
        });
        await setSession(telegramId, user.id, "contact_channel", activeMeetingRequestId);
        await reply(ctx, "Как с вами удобнее связаться по вопросам встречи?", contactChannelKeyboard());
        return;
      }

      case "contact_channel": {
        const channel = parseContactChannel(text);

        if (!channel) {
          await reply(ctx, "Выберите способ связи из списка.", contactChannelKeyboard());
          return;
        }

        if (channel === ContactChannel.TELEGRAM || channel === ContactChannel.EMAIL) {
          await prisma.contactPreference.deleteMany({ where: { meetingRequestId: activeMeetingRequestId } });
          await prisma.contactPreference.create({
            data: {
              userId: user.id,
              meetingRequestId: activeMeetingRequestId,
              channel,
              value: channel === ContactChannel.TELEGRAM ? ctx.from.username ? `@${ctx.from.username}` : null : user.email,
              isPrimary: true
            }
          });
          await prisma.statusHistory.create({
            data: {
              meetingRequestId: activeMeetingRequestId,
              oldStatus: MeetingRequestStatus.DRAFT,
              newStatus: MeetingRequestStatus.DRAFT,
              actorRole: ActorRole.USER,
              actorTelegramId: telegramId,
              reason: "Черновик заявки заполнен до шага выбора слота"
            }
          });
          await reply(ctx, "Данные заявки сохранены. Теперь выберите дату и время встречи.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId);
          return;
        }

        await setSession(telegramId, user.id, "contact_value", activeMeetingRequestId, { pendingContactChannel: channel });
        if (channel === ContactChannel.PHONE) {
          await reply(ctx, "Укажите номер телефона.");
        } else if (channel === ContactChannel.WHATSAPP) {
          await reply(ctx, "Укажите номер WhatsApp.");
        } else {
          await reply(ctx, "Укажите удобный канал связи и контакт.");
        }
        return;
      }

      case "contact_value": {
        const channel = sessionData.pendingContactChannel;

        if (!channel) {
          await setSession(telegramId, user.id, "contact_channel", activeMeetingRequestId);
          await reply(ctx, "Выберите способ связи еще раз.", contactChannelKeyboard());
          return;
        }

        if (!text) {
          await reply(ctx, "Укажите контакт для выбранного способа связи.");
          return;
        }

        await prisma.contactPreference.deleteMany({ where: { meetingRequestId: activeMeetingRequestId } });
        await prisma.contactPreference.create({
          data: {
            userId: user.id,
            meetingRequestId: activeMeetingRequestId,
            channel,
            value: text,
            isPrimary: true
          }
        });
        await prisma.statusHistory.create({
          data: {
            meetingRequestId: activeMeetingRequestId,
            oldStatus: MeetingRequestStatus.DRAFT,
            newStatus: MeetingRequestStatus.DRAFT,
            actorRole: ActorRole.USER,
            actorTelegramId: telegramId,
            reason: "Черновик заявки заполнен до шага выбора слота"
          }
        });
        await reply(ctx, "Данные заявки сохранены. Теперь выберите дату и время встречи.");
        await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId);
        return;
      }

      case "date": {
        const currentPage = sessionData.datePage ?? 0;

        if (text === "Показать еще даты") {
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage + 1);
          return;
        }

        if (text === "Предыдущие даты") {
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage - 1);
          return;
        }

        const schedulingContext = await getSchedulingContext(prisma, config);
        const dateISO = parseDateLabel(text, schedulingContext.settings.timezone);

        if (!dateISO) {
          await reply(ctx, "Выберите дату из списка.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        const availableDates = getAvailableDates(schedulingContext);
        const isDateAvailable = availableDates.some((date) => date.dateISO === dateISO);

        if (!isDateAvailable) {
          await reply(ctx, "Эта дата уже недоступна. Выберите другую дату.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        await showSlotsForDate(ctx, telegramId, user.id, activeMeetingRequestId, dateISO, currentPage);
        return;
      }

      case "slot": {
        const selectedDate = sessionData.selectedDate;
        const currentPage = sessionData.datePage ?? 0;

        if (text === "Выбрать другую дату") {
          await prisma.meetingRequest.update({
            where: { id: activeMeetingRequestId },
            data: {
              selectedStartAt: null,
              selectedEndAt: null
            }
          });
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        if (!selectedDate) {
          await reply(ctx, "Дата не выбрана. Выберите дату встречи.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        const schedulingContext = await getSchedulingContext(prisma, config);
        const slots = getAvailableSlotsForDate({
          ...schedulingContext,
          dateISO: selectedDate
        });
        const slot = slots.find((availableSlot) => availableSlot.startLabel === text || availableSlot.label === text);

        if (!slot) {
          await reply(ctx, "Этот слот уже недоступен. Пожалуйста, выберите другое время.");
          await showSlotsForDate(ctx, telegramId, user.id, activeMeetingRequestId, selectedDate, currentPage);
          return;
        }

        await prisma.meetingRequest.update({
          where: { id: activeMeetingRequestId },
          data: {
            selectedStartAt: slot.startAtUtc,
            selectedEndAt: slot.endAtUtc,
            timezone: schedulingContext.settings.timezone
          }
        });
        await setSession(telegramId, user.id, "confirm", activeMeetingRequestId, {
          selectedDate,
          datePage: currentPage
        });
        await showSlotConfirmation(ctx, activeMeetingRequestId);
        return;
      }

      case "confirm": {
        const currentPage = sessionData.datePage ?? 0;

        if (text === "Выбрать другое время") {
          await prisma.meetingRequest.update({
            where: { id: activeMeetingRequestId },
            data: {
              selectedStartAt: null,
              selectedEndAt: null
            }
          });
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        if (text !== "Отправить заявку") {
          await reply(ctx, "Подтвердите отправку заявки или выберите другое время.", bookingConfirmationKeyboard());
          return;
        }

        const request = await getActiveRequest(activeMeetingRequestId);

        if (!request?.selectedStartAt || !request.selectedEndAt) {
          await reply(ctx, "Время встречи не выбрано. Выберите дату и слот.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        const selectedDate = dateKeyFromUtc(request.selectedStartAt, request.timezone);
        const availableSlots = await getSlotsForDate(selectedDate);
        const slotStillAvailable = availableSlots.some(
          (slot) => slot.startAtUtc.getTime() === request.selectedStartAt?.getTime()
        );

        if (!slotStillAvailable) {
          await prisma.meetingRequest.update({
            where: { id: activeMeetingRequestId },
            data: {
              selectedStartAt: null,
              selectedEndAt: null
            }
          });
          await reply(ctx, "Этот слот уже недоступен. Пожалуйста, выберите другое время.");
          await showAvailableDates(ctx, telegramId, user.id, activeMeetingRequestId, currentPage);
          return;
        }

        const submittedRequest = await prisma.$transaction(async (tx) => {
          const updatedRequest = await tx.meetingRequest.update({
            where: { id: activeMeetingRequestId },
            data: {
              status: MeetingRequestStatus.PENDING_APPROVAL,
              submittedAt: new Date()
            },
            include: {
              user: true,
              contactPreferences: true
            }
          });

          await tx.statusHistory.create({
            data: {
              meetingRequestId: activeMeetingRequestId,
              oldStatus: request.status,
              newStatus: MeetingRequestStatus.PENDING_APPROVAL,
              actorRole: ActorRole.USER,
              actorTelegramId: telegramId,
              reason: "Пользователь выбрал слот и отправил заявку на согласование"
            }
          });

          await tx.botSession.deleteMany({ where: { activeMeetingRequestId } });

          return updatedRequest;
        });

        await notifyAdminAboutRequest(ctx, submittedRequest);
        await reply(
          ctx,
          [
            "Заявка отправлена на согласование.",
            "",
            ...buildRequestSummaryLines(submittedRequest),
            "",
            "После ручного подтверждения встреча появится в Google Calendar, а ссылка Google Meet придет в Telegram."
          ].join("\n"),
          mainMenuKeyboard(isAdmin(ctx))
        );
        return;
      }
    }

    logger.warn({ step: session.currentStep, telegramId }, "Unknown booking step");
  };

  return {
    start,
    cancel,
    myMeetings,
    handleText
  };
};
