import "dotenv/config";

import { createBot } from "./bot/bot.js";
import { isPlaceholderSecret, loadConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { createServer } from "./server/app.js";

const config = loadConfig();
const logger = createLogger(config);

const bot = isPlaceholderSecret(config.telegram.botToken) ? null : createBot(config, logger);
const server = createServer({ config, logger, bot });

try {
  await server.listen({ port: config.app.port, host: "0.0.0.0" });

  logger.info(
    {
      port: config.app.port,
      webhookPath: config.telegram.webhookPath,
      telegramConfigured: Boolean(bot)
    },
    "EnergyCFO bot backend started"
  );
} catch (error) {
  logger.error({ error }, "Failed to start EnergyCFO bot backend");
  process.exit(1);
}

