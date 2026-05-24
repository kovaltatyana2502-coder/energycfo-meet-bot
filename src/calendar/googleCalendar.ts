import type { AppConfig } from "../config/env.js";

export type GoogleCalendarConfig = AppConfig["google"];

export const getGoogleCalendarConfig = (config: AppConfig): GoogleCalendarConfig => config.google;

