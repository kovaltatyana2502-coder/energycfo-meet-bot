import pino from "pino";

import type { AppConfig } from "./env.js";

export const createLogger = (config: AppConfig) =>
  pino({
    name: config.app.name,
    level: config.app.logLevel
  });

export type AppLogger = ReturnType<typeof createLogger>;

