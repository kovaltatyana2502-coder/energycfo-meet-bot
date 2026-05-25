import { resolve } from "node:path";

import Fastify from "fastify";
import type { Update } from "telegraf/types";

import { createGoogleOAuthUrl, exchangeGoogleOAuthCode } from "../calendar/googleOAuth.js";
import { updateEnvFile } from "../config/envFile.js";
import { isPlaceholderSecret, type AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import type { EnergyCfoBot } from "../bot/bot.js";

type CreateServerOptions = {
  config: AppConfig;
  logger: AppLogger;
  bot: EnergyCfoBot | null;
};

type GoogleOAuthCallbackQuery = {
  code?: string;
  error?: string;
};

export const createServer = ({ config, logger, bot }: CreateServerOptions) => {
  const server = Fastify({ loggerInstance: logger });

  server.get("/health", async () => ({
    status: "ok",
    service: config.app.name,
    timezone: config.app.timezone
  }));

  server.get("/google/oauth/start", async (_request, reply) => {
    if (isPlaceholderSecret(config.google.clientId) || isPlaceholderSecret(config.google.clientSecret)) {
      return reply.code(503).send({
        status: "google_oauth_not_configured"
      });
    }

    return reply.redirect(createGoogleOAuthUrl(config));
  });

  server.get("/google/oauth/callback", async (request, reply) => {
    const query = request.query as GoogleOAuthCallbackQuery;

    if (query.error) {
      return reply.type("text/html; charset=utf-8").code(400).send(`
        <h1>Google OAuth не завершен</h1>
        <p>Google вернул ошибку: ${query.error}</p>
        <p>Закройте вкладку и попробуйте авторизацию заново.</p>
      `);
    }

    if (!query.code) {
      return reply.type("text/html; charset=utf-8").code(400).send(`
        <h1>Google OAuth не завершен</h1>
        <p>В callback не пришел authorization code.</p>
      `);
    }

    const tokens = await exchangeGoogleOAuthCode(config, query.code);

    if (!tokens.refresh_token) {
      return reply.type("text/html; charset=utf-8").code(400).send(`
        <h1>Refresh token не получен</h1>
        <p>Повторите авторизацию через /google/oauth/start. Если ранее уже выдавали доступ, отзовите доступ приложения в Google Account и попробуйте снова.</p>
      `);
    }

    await updateEnvFile(resolve(process.cwd(), ".env"), {
      GOOGLE_REFRESH_TOKEN: tokens.refresh_token
    });

    return reply.type("text/html; charset=utf-8").send(`
      <h1>Google OAuth подключен</h1>
      <p>Refresh token сохранен локально в .env.</p>
      <p>Можно закрыть эту вкладку и вернуться в Telegram/чат.</p>
    `);
  });

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
