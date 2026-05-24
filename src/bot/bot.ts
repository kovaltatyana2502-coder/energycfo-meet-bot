import { Telegraf } from "telegraf";

import { createBookingFlow } from "./bookingFlow.js";
import { adminMenuKeyboard, mainMenuKeyboard } from "./keyboards.js";
import { messages } from "./messages.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import { prisma } from "../db/prisma.js";

export const createBot = (config: AppConfig, logger: AppLogger) => {
  const bot = new Telegraf(config.telegram.botToken);
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
    const isAdmin = String(ctx.from?.id) === config.telegram.adminId;

    if (!isAdmin) {
      await ctx.reply(messages.technicalError);
      return;
    }

    await ctx.reply(messages.adminPanel, adminMenuKeyboard());
  });

  bot.on("text", bookingFlow.handleText);

  bot.catch((error, ctx) => {
    logger.error(
      {
        error,
        updateType: ctx.updateType,
        userId: ctx.from?.id
      },
      "Telegram bot handler failed"
    );
  });

  return bot;
};

export type EnergyCfoBot = ReturnType<typeof createBot>;
