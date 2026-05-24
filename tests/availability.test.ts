import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  getAvailableDates,
  getAvailableSlotsForDate,
  type BusyInterval,
  type SchedulingSettings
} from "../src/scheduling/availability.js";

const timezone = "Europe/Moscow";

const settings: SchedulingSettings = {
  timezone,
  workingDays: [1, 2, 3, 4, 5],
  workingHoursStart: "10:00",
  workingHoursEnd: "18:00",
  meetingDurationMinutes: 60,
  meetingBufferMinutes: 30,
  meetingMinLeadHours: 12,
  meetingDailyLimit: 5,
  userBookingHorizonMonths: 2
};

const now = DateTime.fromISO("2026-05-25T09:00:00", { zone: timezone });

const toUtcDate = (iso: string) => DateTime.fromISO(iso, { zone: timezone }).toUTC().toJSDate();

describe("availability calculation", () => {
  it("does not show slots earlier than the 12 hour lead time", () => {
    const slots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-25",
      now
    });

    expect(slots).toHaveLength(0);
  });

  it("shows working day slots inside the user horizon", () => {
    const slots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-26",
      now
    });

    expect(slots.at(0)?.label).toBe("10:00-11:00");
    expect(slots.at(-1)?.label).toBe("17:00-18:00");
  });

  it("hides weekends and excluded dates", () => {
    const weekendSlots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-30",
      now
    });
    const excludedSlots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-26",
      excludedDateKeys: new Set(["2026-05-26"]),
      now
    });

    expect(weekendSlots).toHaveLength(0);
    expect(excludedSlots).toHaveLength(0);
  });

  it("applies buffer around busy intervals", () => {
    const busyIntervals: BusyInterval[] = [
      {
        startAt: toUtcDate("2026-05-26T11:00:00"),
        endAt: toUtcDate("2026-05-26T12:00:00")
      }
    ];
    const slots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-26",
      busyIntervals,
      now
    });

    expect(slots.map((slot) => slot.startLabel)).not.toContain("10:00");
    expect(slots.map((slot) => slot.startLabel)).not.toContain("12:00");
    expect(slots.map((slot) => slot.startLabel)).toContain("12:30");
  });

  it("hides a day when the daily limit is reached", () => {
    const busyIntervals: BusyInterval[] = Array.from({ length: 5 }, (_, index) => ({
      startAt: toUtcDate(`2026-05-26T${String(10 + index).padStart(2, "0")}:00:00`),
      endAt: toUtcDate(`2026-05-26T${String(11 + index).padStart(2, "0")}:00:00`)
    }));
    const slots = getAvailableSlotsForDate({
      settings,
      dateISO: "2026-05-26",
      busyIntervals,
      now
    });

    expect(slots).toHaveLength(0);
  });

  it("returns only dates that have available slots", () => {
    const dates = getAvailableDates({
      settings,
      excludedDateKeys: new Set(["2026-05-26"]),
      now
    });

    expect(dates.at(0)?.dateISO).toBe("2026-05-27");
  });
});
