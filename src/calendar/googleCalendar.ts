import { randomUUID } from "node:crypto";

import { google, calendar_v3 } from "googleapis";

import { isPlaceholderSecret, type AppConfig } from "../config/env.js";
import { createGoogleOAuthClient } from "./googleOAuth.js";
import type { BusyInterval } from "../scheduling/availability.js";

export type GoogleCalendarConfig = AppConfig["google"];

export const getGoogleCalendarConfig = (config: AppConfig): GoogleCalendarConfig => config.google;

export type CalendarMeetingRequest = {
  id: string;
  requestNumber: number;
  topicText: string | null;
  comment: string | null;
  selectedStartAt: Date;
  selectedEndAt: Date;
  timezone: string;
  user: {
    fullName: string | null;
    company: string | null;
    position: string | null;
    email: string | null;
    telegramUsername: string | null;
    telegramId: string;
  };
};

export type CreatedCalendarEvent = {
  calendarId: string;
  eventId: string;
  htmlLink: string | null;
  meetLink: string | null;
};

export type UpdatedCalendarEvent = CreatedCalendarEvent;

export type CancelCalendarEventResult = {
  deleted: boolean;
  notFound: boolean;
};

export type GoogleBusyRange = {
  timeMin: Date;
  timeMax: Date;
};

const getGoogleErrorStatus = (error: unknown) => {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "number") {
    return error.code;
  }

  return null;
};

const ensureGoogleCalendarConfigured = (config: AppConfig) => {
  if (
    isPlaceholderSecret(config.google.clientId) ||
    isPlaceholderSecret(config.google.clientSecret) ||
    isPlaceholderSecret(config.google.refreshToken) ||
    isPlaceholderSecret(config.google.calendarId)
  ) {
    throw new Error("Google Calendar is not configured");
  }
};

export const isGoogleCalendarConfigured = (config: AppConfig) =>
  !(
    isPlaceholderSecret(config.google.clientId) ||
    isPlaceholderSecret(config.google.clientSecret) ||
    isPlaceholderSecret(config.google.refreshToken) ||
    isPlaceholderSecret(config.google.calendarId)
  );

export const getFreeBusyCalendarIds = (config: AppConfig) => {
  const calendarIds = ["primary", config.google.calendarId, ...config.google.freebusyCalendarIds].filter(
    (calendarId) => !isPlaceholderSecret(calendarId)
  );

  return [...new Set(calendarIds)];
};

const createCalendarClient = (config: AppConfig) => {
  ensureGoogleCalendarConfigured(config);

  const auth = createGoogleOAuthClient(config);
  auth.setCredentials({ refresh_token: config.google.refreshToken });

  return google.calendar({ version: "v3", auth });
};

const getTelegramLabel = (request: CalendarMeetingRequest) =>
  request.user.telegramUsername ? `@${request.user.telegramUsername}` : `ID ${request.user.telegramId}`;

export const buildCalendarEventBody = (request: CalendarMeetingRequest): calendar_v3.Schema$Event => {
  const attendee = request.user.email ? [{ email: request.user.email, displayName: request.user.fullName }] : [];

  return {
    summary: `EnergyCFO: ${request.topicText ?? "B2B-встреча"}`,
    description: [
      `Заявка #${request.requestNumber}`,
      `Тема: ${request.topicText ?? "не указана"}`,
      `ФИО: ${request.user.fullName ?? "не указано"}`,
      `Компания: ${request.user.company ?? "не указана"}`,
      `Должность: ${request.user.position ?? "не указана"}`,
      `Email: ${request.user.email ?? "не указан"}`,
      `Telegram: ${getTelegramLabel(request)}`,
      "",
      "Комментарий:",
      request.comment ?? "не указан"
    ].join("\n"),
    start: {
      dateTime: request.selectedStartAt.toISOString(),
      timeZone: request.timezone
    },
    end: {
      dateTime: request.selectedEndAt.toISOString(),
      timeZone: request.timezone
    },
    attendees: attendee,
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    conferenceData: {
      createRequest: {
        requestId: `energycfo-${request.id}-${randomUUID()}`,
        conferenceSolutionKey: {
          type: "hangoutsMeet"
        }
      }
    }
  };
};

export const buildCalendarEventPatchBody = (request: CalendarMeetingRequest): calendar_v3.Schema$Event => {
  const { conferenceData: _conferenceData, ...eventBody } = buildCalendarEventBody(request);

  return eventBody;
};

export const extractMeetLink = (event: calendar_v3.Schema$Event) =>
  event.hangoutLink ??
  event.conferenceData?.entryPoints?.find((entryPoint) => entryPoint.entryPointType === "video")?.uri ??
  null;

const wait = async (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const getEventWithMeetLink = async (
  calendar: calendar_v3.Calendar,
  calendarId: string,
  event: calendar_v3.Schema$Event
) => {
  if (!event.id || extractMeetLink(event)) {
    return event;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(1000);

    const response = await calendar.events.get({
      calendarId,
      eventId: event.id
    });
    const refreshedEvent = response.data;

    if (extractMeetLink(refreshedEvent)) {
      return refreshedEvent;
    }
  }

  return event;
};

export const createCalendarMeetingEvent = async (
  config: AppConfig,
  request: CalendarMeetingRequest
): Promise<CreatedCalendarEvent> => {
  const calendar = createCalendarClient(config);
  const response = await calendar.events.insert({
    calendarId: config.google.calendarId,
    conferenceDataVersion: 1,
    sendUpdates: "all",
    requestBody: buildCalendarEventBody(request)
  });
  const event = await getEventWithMeetLink(calendar, config.google.calendarId, response.data);

  if (!event.id) {
    throw new Error("Google Calendar did not return event id");
  }

  return {
    calendarId: config.google.calendarId,
    eventId: event.id,
    htmlLink: event.htmlLink ?? null,
    meetLink: extractMeetLink(event)
  };
};

export const updateCalendarMeetingEvent = async (
  config: AppConfig,
  calendarId: string,
  eventId: string,
  request: CalendarMeetingRequest
): Promise<UpdatedCalendarEvent> => {
  const calendar = createCalendarClient(config);
  const response = await calendar.events.patch({
    calendarId,
    eventId,
    sendUpdates: "all",
    requestBody: buildCalendarEventPatchBody(request)
  });

  if (!response.data.id) {
    throw new Error("Google Calendar did not return event id");
  }

  return {
    calendarId,
    eventId: response.data.id,
    htmlLink: response.data.htmlLink ?? null,
    meetLink: extractMeetLink(response.data)
  };
};

export const cancelCalendarMeetingEvent = async (
  config: AppConfig,
  calendarId: string,
  eventId: string
): Promise<CancelCalendarEventResult> => {
  const calendar = createCalendarClient(config);

  try {
    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "all"
    });

    return {
      deleted: true,
      notFound: false
    };
  } catch (error) {
    if (getGoogleErrorStatus(error) === 404) {
      return {
        deleted: false,
        notFound: true
      };
    }

    throw error;
  }
};

export const getGoogleCalendarBusyIntervals = async (
  config: AppConfig,
  range: GoogleBusyRange
): Promise<BusyInterval[]> => {
  const calendar = createCalendarClient(config);
  const calendarIds = getFreeBusyCalendarIds(config);
  const response = await calendar.freebusy.query({
    requestBody: {
      timeMin: range.timeMin.toISOString(),
      timeMax: range.timeMax.toISOString(),
      timeZone: config.app.timezone,
      items: calendarIds.map((id) => ({ id }))
    }
  });
  const busy = Object.values(response.data.calendars ?? {}).flatMap((calendarData) => calendarData.busy ?? []);
  const seenIntervals = new Set<string>();

  return busy.flatMap((interval) => {
    if (!interval.start || !interval.end) {
      return [];
    }

    const intervalKey = `${interval.start}-${interval.end}`;

    if (seenIntervals.has(intervalKey)) {
      return [];
    }

    seenIntervals.add(intervalKey);

    return [
      {
        startAt: new Date(interval.start),
        endAt: new Date(interval.end)
      }
    ];
  });
};
