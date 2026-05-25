import { describe, expect, it } from "vitest";

import { buildCalendarEventBody, extractMeetLink } from "../src/calendar/googleCalendar.js";

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
});
