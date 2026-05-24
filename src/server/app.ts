import Fastify from "fastify";
import type { Update } from "telegraf/types";

import { isPlaceholderSecret, type AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import type { EnergyCfoBot } from "../bot/bot.js";

type CreateServerOptions = {
  config: AppConfig;
  logger: AppLogger;
  bot: EnergyCfoBot | null;
};

export const createServer = ({ config, logger, bot }: CreateServerOptions) => {
  const server = Fastify({ loggerInstance: logger });

  server.get("/health", async () => ({
    status: "ok",
    service: config.app.name,
    timezone: config.app.timezone
  }));

  server.post(config.telegram.webhookPath, async (request, reply) => {
    if (!bot) {
      return reply.code(503).send({
        status: "bot_not_configured"
      });
    }

    if (!isPlaceholderSecret(config.telegram.webhookSecret)) {
      const headerSecret = request.headers["x-telegram-bot-api-secret-token"];

      if (headerSecret !== config.telegram.webhookSecret) {
        return reply.code(401).send({
          status: "unauthorized"
        });
      }
    }

    await bot.handleUpdate(request.body as Update);

    return {
      ok: true
    };
  });

  return server;
};

export type AppServer = ReturnType<typeof createServer>;

