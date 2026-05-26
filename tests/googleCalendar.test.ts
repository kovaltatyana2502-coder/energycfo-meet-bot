import { describe, expect, it } from "vitest";

import {
  buildCalendarEventBody,
  buildCalendarEventPatchBody,
  extractMeetLink,
  getFreeBusyCalendarIds,
  isGoogleCalendarConfigured
} from "../src/calendar/googleCalendar.js";
import { loadConfig } from "../src/config/env.js";

describe("google calendar helpers", () => {
  it("builds a calendar event with attendee and Google Meet request", () => {
    const body = buildCalendarEventBody({
      id: "request-id",
      requestNumber: 15,
      topicText: "Тарифная кампания",
      comment: "Обсудить тарифные решения",
      selectedStartAt: new Date("2026-05-26T07:00:00.000Z"),
      selectedEndAt: new Date("2026-05-26T08:00:00.000Z"),
      timezone: "Europe/Moscow",
      user: {
        fullName: "Тестовый Пользователь",
        company: "Тест Энерго",
        position: "Финансовый директор",
        email: "user@example.com",
        telegramUsername: "test_user",
        telegramId: "123"
      }
    });

    expect(body.summary).toBe("EnergyCFO: Тарифная кампания");
    expect(body.start?.dateTime).toBe("2026-05-26T07:00:00.000Z");
    expect(body.end?.dateTime).toBe("2026-05-26T08:00:00.000Z");
    expect(body.attendees).toEqual([{ email: "user@example.com", displayName: "Тестовый Пользователь" }]);
    expect(body.conferenceData?.createRequest?.conferenceSolutionKey?.type).toBe("hangoutsMeet");
    expect(body.description).toContain("Заявка #15");
  });

  it("builds a calendar event patch without creating a new Meet link", () => {
    const body = buildCalendarEventPatchBody({
      id: "request-id",
      requestNumber: 15,
      topicText: "Перенос встречи",
      comment: "Новое время",
      selectedStartAt: new Date("2026-05-27T07:00:00.000Z"),
      selectedEndAt: new Date("2026-05-27T08:00:00.000Z"),
      timezone: "Europe/Moscow",
      user: {
        fullName: "Тестовый Пользователь",
        company: "Тест Энерго",
        position: "Финансовый директор",
        email: "user@example.com",
        telegramUsername: "test_user",
        telegramId: "123"
      }
    });

    expect(body.start?.dateTime).toBe("2026-05-27T07:00:00.000Z");
    expect(body.end?.dateTime).toBe("2026-05-27T08:00:00.000Z");
    expect(body.conferenceData).toBeUndefined();
  });

  it("extracts Google Meet link from event data", () => {
    expect(
      extractMeetLink({
        conferenceData: {
          entryPoints: [
            {
              entryPointType: "video",
              uri: "https://meet.google.com/test-link"
            }
          ]
        }
      })
    ).toBe("https://meet.google.com/test-link");
  });

  it("detects placeholder Google Calendar configuration", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "replace_me",
      TELEGRAM_ADMIN_ID: "replace_me",
      DATABASE_URL: "postgresql://user:password@localhost:5432/db",
      GOOGLE_CLIENT_ID: "replace_me",
      GOOGLE_CLIENT_SECRET: "replace_me",
      GOOGLE_REFRESH_TOKEN: "replace_me",
      GOOGLE_CALENDAR_ID: "replace_me"
    });

    expect(isGoogleCalendarConfigured(config)).toBe(false);
  });

  it("uses primary, meetings and extra calendars for freebusy", () => {
    const config = loadConfig({
      TELEGRAM_BOT_TOKEN: "replace_me",
      TELEGRAM_ADMIN_ID: "replace_me",
      DATABASE_URL: "postgresql://user:password@localhost:5432/db",
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      GOOGLE_REFRESH_TOKEN: "refresh-token",
      GOOGLE_CALENDAR_ID: "meetings-calendar-id",
      GOOGLE_FREEBUSY_CALENDAR_IDS: "tatyana.koval.2502@gmail.com, meetings-calendar-id"
    });

    expect(getFreeBusyCalendarIds(config)).toEqual([
      "primary",
      "meetings-calendar-id",
      "tatyana.koval.2502@gmail.com"
    ]);
  });
});
