import "dotenv/config";

import { createBot } from "../src/bot/bot.js";
import { isPlaceholderSecret, loadConfig } from "../src/config/env.js";
import { createLogger } from "../src/config/logger.js";
import { prisma } from "../src/db/prisma.js";
import { runOperationsChecksOnce } from "../src/operations/index.js";

const config = loadConfig();
const logger = createLogger(config);
const bot =
  isPlaceholderSecret(config.telegram.botToken) || config.telegram.runMode === "off" ? null : createBot(config, logger);

try {
  const stats = await runOperationsChecksOnce({
    config,
    logger,
    prisma,
    telegram: bot?.telegram ?? null
  });

  console.log(JSON.stringify(stats, null, 2));
} finally {
  await prisma.$disconnect();
}
