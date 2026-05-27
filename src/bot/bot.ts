import { Telegraf } from "telegraf";

import { createAdminFlow } from "./adminFlow.js";
import { createBookingFlow } from "./bookingFlow.js";
import { mainMenuKeyboard } from "./keyboards.js";
import { messages } from "./messages.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import { prisma } from "../db/prisma.js";
import { recordTechnicalError } from "../operations/index.js";

export const createBot = (config: AppConfig, logger: AppLogger) => {
  const bot = new Telegraf(config.telegram.botToken);
  const adminFlow = createAdminFlow(config, logger, prisma);
  const bookingFlow = createBookingFlow(config, logger, prisma);

  bot.start(async (ctx) => {
    const isAdmin = String(ctx.from?.id) === config.telegram.adminId;
    await ctx.reply(messages.start, mainMenuKeyboard(isAdmin));
  });

  bot.hears("Помощь", async (ctx) => {
    await ctx.reply(messages.help);
  });

  bot.hears("Назначить встречу", bookingFlow.start);

  bot.hears("Мои встречи", bookingFlow.myMeetings);

  bot.hears("Админ-панель", async (ctx) => {
    await adminFlow.panel(ctx);
  });

  bot.on("text", async (ctx) => {
    const textContext = ctx as Parameters<typeof bookingFlow.handleText>[0];
    const handledByAdmin = await adminFlow.handleText(textContext);

    if (!handledByAdmin) {
      await bookingFlow.handleText(textContext);
    }
  });

  bot.catch(async (error, ctx) => {
    await recordTechnicalError(
      {
        config,
        logger,
        prisma,
        telegram: bot.telegram
      },
      {
        module: "telegram",
        action: "handler_failed",
        message: "Telegram bot handler failed",
        error,
        metadata: {
          updateType: ctx.updateType,
          userId: ctx.from?.id ? String(ctx.from.id) : null
        }
      }
    );
  });

  return bot;
};

export type EnergyCfoBot = ReturnType<typeof createBot>;
