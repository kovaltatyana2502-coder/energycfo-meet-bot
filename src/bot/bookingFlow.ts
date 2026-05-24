import {
  ActorRole,
  ContactChannel,
  MeetingRequestStatus,
  MeetingTopic,
  PrismaClient
} from "@prisma/client";
import type { Context, Markup } from "telegraf";

import { contactChannelKeyboard, consentKeyboard, mainMenuKeyboard, topicKeyboard } from "./keyboards.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";

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
  | "contact_value";

type SessionData = {
  pendingContactChannel?: ContactChannel;
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
      ""
    ]);

    await reply(ctx, ["Ваши активные заявки и встречи:", "", ...lines].join("\n").trim(), mainMenuKeyboard(isAdmin(ctx)));
  };

  const showSummary = async (ctx: Context, activeMeetingRequestId: string) => {
    const request = await getActiveRequest(activeMeetingRequestId);

    if (!request) {
      await reply(ctx, "Черновик заявки не найден. Начните запись заново.", mainMenuKeyboard(isAdmin(ctx)));
      return;
    }

    const contactPreference = request.contactPreferences.at(0);
    const contactText = contactPreference
      ? `${contactPreference.channel}${contactPreference.value ? `: ${contactPreference.value}` : ""}`
      : "не указан";

    await prisma.botSession.deleteMany({ where: { activeMeetingRequestId } });

    await reply(
      ctx,
      [
        "Данные заявки сохранены.",
        "",
        `Заявка: #${request.requestNumber}`,
        `Статус: ${statusLabels[request.status]}`,
        `Тема: ${request.topicText ?? "не указана"}`,
        `ФИО: ${request.user.fullName ?? "не указано"}`,
        `Компания: ${request.user.company ?? "не указана"}`,
        `Должность: ${request.user.position ?? "не указана"}`,
        `Email: ${request.user.email ?? "не указан"}`,
        `Способ связи: ${contactText}`,
        `Комментарий: ${request.comment ?? "не указан"}`,
        "",
        "Следующий шаг разработки - выбор даты и свободного слота. Пока заявка остается в статусе «Черновик»."
      ].join("\n"),
      mainMenuKeyboard(isAdmin(ctx))
    );
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
          await showSummary(ctx, activeMeetingRequestId);
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
        await showSummary(ctx, activeMeetingRequestId);
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
