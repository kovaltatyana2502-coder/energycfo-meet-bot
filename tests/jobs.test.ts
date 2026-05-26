import { NotificationType } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { getAdminReminderType, shouldAutoCancelRequest, shouldSendMeetingReminder } from "../src/jobs/index.js";

describe("background jobs helpers", () => {
  it("maps admin reminder hours to notification types", () => {
    expect(getAdminReminderType(2)).toBe(NotificationType.ADMIN_REMINDER_2H);
    expect(getAdminReminderType(12)).toBe(NotificationType.ADMIN_REMINDER_12H);
    expect(getAdminReminderType(24)).toBe(NotificationType.ADMIN_REMINDER_24H);
    expect(getAdminReminderType(3)).toBeNull();
  });

  it("detects unresolved requests inside minimum lead time", () => {
    const now = new Date("2026-05-26T09:00:00.000Z");

    expect(shouldAutoCancelRequest(now, new Date("2026-05-26T20:59:00.000Z"), 12)).toBe(true);
    expect(shouldAutoCancelRequest(now, new Date("2026-05-26T21:01:00.000Z"), 12)).toBe(false);
    expect(shouldAutoCancelRequest(now, null, 12)).toBe(false);
  });

  it("detects user reminder windows without double sending 24h and 1h reminders", () => {
    const now = new Date("2026-05-26T09:00:00.000Z");

    expect(shouldSendMeetingReminder(now, new Date("2026-05-27T08:30:00.000Z"), 24)).toBe(true);
    expect(shouldSendMeetingReminder(now, new Date("2026-05-26T09:30:00.000Z"), 24)).toBe(false);
    expect(shouldSendMeetingReminder(now, new Date("2026-05-26T09:30:00.000Z"), 1)).toBe(true);
    expect(shouldSendMeetingReminder(now, new Date("2026-05-26T08:59:00.000Z"), 1)).toBe(false);
  });
});
