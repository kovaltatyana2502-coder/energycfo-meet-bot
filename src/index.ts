import "dotenv/config";

import { createBot } from "./bot/bot.js";
import { isPlaceholderSecret, loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createServer } from "./server/app.js";

const config = loadConfig();
const logger = createLogger(config);

const bot =
  isPlaceholderSecret(config.telegram.botToken) || config.telegram.runMode === "off" ? null : createBot(config, logger);
const server = createServer({ config, logger, bot });
let pollingStarted = false;

const shutdown = async (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Shutting down EnergyCFO bot backend");

  if (bot && pollingStarted) {
    try {
      bot.stop(signal);
    } catch (error) {
      logger.warn({ error }, "Telegram bot was not running during shutdown");
    }
  }

  await server.close();
  process.exit(0);
};

try {
  await server.listen({ port: config.app.port, host: "0.0.0.0" });

  if (bot && config.telegram.runMode === "polling") {
    void bot
      .launch({
        dropPendingUpdates: config.telegram.dropPendingUpdates
      })
      .then(() => {
        logger.info("Telegram polling stopped");
      })
      .catch((error) => {
        logger.error({ error }, "Telegram polling failed");
        process.exit(1);
      });

    pollingStarted = true;
  }

  logger.info(
    {
      port: config.app.port,
      telegramRunMode: config.telegram.runMode,
      webhookPath: config.telegram.webhookPath,
      pollingStarted,
      telegramConfigured: Boolean(bot)
    },
    "EnergyCFO bot backend started"
  );

  process.once("SIGINT", (signal) => {
    void shutdown(signal);
  });
  process.once("SIGTERM", (signal) => {
    void shutdown(signal);
  });
} catch (error) {
  logger.error({ error }, "Failed to start EnergyCFO bot backend");
  process.exit(1);
}
