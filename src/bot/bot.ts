import { Telegraf } from "telegraf";

import { adminMenuKeyboard, mainMenuKeyboard } from "./keyboards.js";
import { messages } from "./messages.js";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";

export const createBot = (config: AppConfig, logger: AppLogger) => {
  const bot = new Telegraf(config.telegram.botToken);

  bot.start(async (ctx) => {
    const isAdmin = String(ctx.from?.id) === config.telegram.adminId;
    await ctx.reply(messages.start, mainMenuKeyboard(isAdmin));
  });

  bot.hears("Помощь", async (ctx) => {
    await ctx.reply(messages.help);
  });

  bot.hears("Админ-панель", async (ctx) => {
    const isAdmin = String(ctx.from?.id) === config.telegram.adminId;

    if (!isAdmin) {
      await ctx.reply(messages.technicalError);
      return;
    }

    await ctx.reply(messages.adminPanel, adminMenuKeyboard());
  });

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

