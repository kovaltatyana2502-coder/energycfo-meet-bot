import type { AppConfig } from "../config/env.js";

export type SchedulingRules = AppConfig["scheduling"];

export const getDefaultSchedulingRules = (config: AppConfig): SchedulingRules => config.scheduling;

