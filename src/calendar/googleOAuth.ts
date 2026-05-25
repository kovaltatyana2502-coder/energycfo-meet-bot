import { google } from "googleapis";

import type { AppConfig } from "../config/env.js";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.readonly"
] as const;

export const createGoogleOAuthClient = (config: AppConfig) =>
  new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);

export const createGoogleOAuthUrl = (config: AppConfig) =>
  createGoogleOAuthClient(config).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GOOGLE_CALENDAR_SCOPES]
  });

export const exchangeGoogleOAuthCode = async (config: AppConfig, code: string) => {
  const oauth2Client = createGoogleOAuthClient(config);
  const { tokens } = await oauth2Client.getToken(code);

  return tokens;
};
