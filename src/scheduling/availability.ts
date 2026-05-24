import { MeetingRequestStatus, MeetingStatus, type PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import type { AppConfig } from "../config/env.js";

const SLOT_STEP_MINUTES = 30;

export type SchedulingSettings = {
  timezone: string;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  meetingDurationMinutes: number;
  meetingBufferMinutes: number;
  meetingMinLeadHours: number;
  meetingDailyLimit: number;
  userBookingHorizonMonths: number;
};

export type BusyInterval = {
  startAt: Date;
  endAt: Date;
};

export type AvailableSlot = {
  dateISO: string;
  startAtUtc: Date;
  endAtUtc: Date;
  startLabel: string;
  endLabel: string;
  label: string;
};

export type AvailableDate = {
  dateISO: string;
  label: string;
  slotsCount: number;
};

type AvailabilityInput = {
  settings: SchedulingSettings;
  busyIntervals?: BusyInterval[];
  excludedDateKeys?: Set<string>;
  now?: DateTime;
};

type SlotsForDateInput = AvailabilityInput & {
  dateISO: string;
};

const parseTime = (value: string) => {
  const [hourText, minuteText] = value.split(":");
  const hour = Number.parseInt(hourText ?? "", 10);
  const minute = Number.parseInt(minuteText ?? "", 10);

  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    throw new Error(`Invalid time value: ${value}`);
  }

  return { hour, minute };
};

const getNow = (settings: SchedulingSettings, now?: DateTime) =>
  (now ?? DateTime.now()).setZone(settings.timezone);

const getRange = (settings: SchedulingSettings, now?: DateTime) => {
  const zonedNow = getNow(settings, now);

  return {
    now: zonedNow,
    minStart: zonedNow.plus({ hours: settings.meetingMinLeadHours }),
    horizonEnd: zonedNow.plus({ months: settings.userBookingHorizonMonths }).endOf("day")
  };
};

const getDateStart = (dateISO: string, timezone: string) => DateTime.fromISO(dateISO, { zone: timezone }).startOf("day");

const toDateKey = (value: DateTime) => value.toISODate() ?? "";

export const dateKeyFromUtc = (value: Date, timezone: string) =>
  DateTime.fromJSDate(value, { zone: "utc" }).setZone(timezone).toISODate() ?? "";

export const dateKeyFromDbDate = (value: Date) => DateTime.fromJSDate(value, { zone: "utc" }).toISODate() ?? "";

export const formatDateLabel = (dateISO: string, timezone: string) =>
  getDateStart(dateISO, timezone).toFormat("dd.MM.yyyy");

export const parseDateLabel = (value: string, timezone: string) => {
  const parsed = DateTime.fromFormat(value.trim(), "dd.MM.yyyy", { zone: timezone });

  return parsed.isValid ? toDateKey(parsed) : null;
};

export const formatSlotRange = (startAt: Date, endAt: Date, timezone: string) => {
  const start = DateTime.fromJSDate(startAt, { zone: "utc" }).setZone(timezone);
  const end = DateTime.fromJSDate(endAt, { zone: "utc" }).setZone(timezone);

  return `${start.toFormat("dd.MM.yyyy HH:mm")}-${end.toFormat("HH:mm")} МСК`;
};

const countBusyItemsOnDate = (busyIntervals: BusyInterval[], dateISO: string, timezone: string) => {
  const keys = new Set<string>();

  for (const interval of busyIntervals) {
    if (dateKeyFromUtc(interval.startAt, timezone) === dateISO) {
      keys.add(`${interval.startAt.getTime()}-${interval.endAt.getTime()}`);
    }
  }

  return keys.size;
};

const hasBufferedConflict = (
  slotStart: DateTime,
  slotEnd: DateTime,
  busyIntervals: BusyInterval[],
  settings: SchedulingSettings
) =>
  busyIntervals.some((interval) => {
    const busyStart = DateTime.fromJSDate(interval.startAt, { zone: "utc" })
      .setZone(settings.timezone)
      .minus({ minutes: settings.meetingBufferMinutes });
    const busyEnd = DateTime.fromJSDate(interval.endAt, { zone: "utc" })
      .setZone(settings.timezone)
      .plus({ minutes: settings.meetingBufferMinutes });

    return slotStart.toMillis() < busyEnd.toMillis() && slotEnd.toMillis() > busyStart.toMillis();
  });

export const getAvailableSlotsForDate = ({
  settings,
  dateISO,
  busyIntervals = [],
  excludedDateKeys = new Set<string>(),
  now
}: SlotsForDateInput): AvailableSlot[] => {
  const dayStart = getDateStart(dateISO, settings.timezone);

  if (!dayStart.isValid) {
    return [];
  }

  if (!settings.workingDays.includes(dayStart.weekday)) {
    return [];
  }

  if (excludedDateKeys.has(dateISO)) {
    return [];
  }

  if (countBusyItemsOnDate(busyIntervals, dateISO, settings.timezone) >= settings.meetingDailyLimit) {
    return [];
  }

  const { minStart, horizonEnd } = getRange(settings, now);
  const workStartParts = parseTime(settings.workingHoursStart);
  const workEndParts = parseTime(settings.workingHoursEnd);
  const workStart = dayStart.set({ ...workStartParts, second: 0, millisecond: 0 });
  const workEnd = dayStart.set({ ...workEndParts, second: 0, millisecond: 0 });
  const slots: AvailableSlot[] = [];

  for (
    let slotStart = workStart;
    slotStart.plus({ minutes: settings.meetingDurationMinutes }).toMillis() <= workEnd.toMillis();
    slotStart = slotStart.plus({ minutes: SLOT_STEP_MINUTES })
  ) {
    const slotEnd = slotStart.plus({ minutes: settings.meetingDurationMinutes });

    if (slotStart.toMillis() < minStart.toMillis()) {
      continue;
    }

    if (slotStart.toMillis() > horizonEnd.toMillis()) {
      continue;
    }

    if (hasBufferedConflict(slotStart, slotEnd, busyIntervals, settings)) {
      continue;
    }

    const startAtUtc = slotStart.toUTC().toJSDate();
    const endAtUtc = slotEnd.toUTC().toJSDate();
    const startLabel = slotStart.toFormat("HH:mm");
    const endLabel = slotEnd.toFormat("HH:mm");

    slots.push({
      dateISO,
      startAtUtc,
      endAtUtc,
      startLabel,
      endLabel,
      label: `${startLabel}-${endLabel}`
    });
  }

  return slots;
};

export const getAvailableDates = ({
  settings,
  busyIntervals = [],
  excludedDateKeys = new Set<string>(),
  now
}: AvailabilityInput): AvailableDate[] => {
  const { now: zonedNow, horizonEnd } = getRange(settings, now);
  const dates: AvailableDate[] = [];

  for (
    let day = zonedNow.startOf("day");
    day.toMillis() <= horizonEnd.toMillis();
    day = day.plus({ days: 1 })
  ) {
    const dateISO = toDateKey(day);
    const slots = getAvailableSlotsForDate({
      settings,
      dateISO,
      busyIntervals,
      excludedDateKeys,
      now: zonedNow
    });

    if (slots.length > 0) {
      dates.push({
        dateISO,
        label: formatDateLabel(dateISO, settings.timezone),
        slotsCount: slots.length
      });
    }
  }

  return dates;
};

export const getSchedulingSettings = async (prisma: PrismaClient, config: AppConfig): Promise<SchedulingSettings> => {
  const dbSettings = await prisma.availabilitySettings.findFirst({
    where: { isActive: true },
    orderBy: { updatedAt: "desc" }
  });

  if (!dbSettings) {
    return {
      timezone: config.app.timezone,
      ...config.scheduling
    };
  }

  return {
    timezone: dbSettings.timezone,
    workingDays: dbSettings.workingDays,
    workingHoursStart: dbSettings.workingHoursStart,
    workingHoursEnd: dbSettings.workingHoursEnd,
    meetingDurationMinutes: dbSettings.meetingDurationMinutes,
    meetingBufferMinutes: dbSettings.meetingBufferMinutes,
    meetingMinLeadHours: dbSettings.meetingMinLeadHours,
    meetingDailyLimit: dbSettings.meetingDailyLimit,
    userBookingHorizonMonths: dbSettings.userBookingHorizonMonths
  };
};

export const getSchedulingContext = async (
  prisma: PrismaClient,
  config: AppConfig,
  externalBusyIntervals: BusyInterval[] = []
) => {
  const settings = await getSchedulingSettings(prisma, config);
  const now = DateTime.now().setZone(settings.timezone);
  const horizonEnd = now.plus({ months: settings.userBookingHorizonMonths }).endOf("day");
  const rangeStartUtc = now.startOf("day").toUTC().toJSDate();
  const rangeEndUtc = horizonEnd.toUTC().toJSDate();
  const excludedDates = await prisma.excludedDate.findMany({
    where: {
      timezone: settings.timezone,
      date: {
        gte: rangeStartUtc,
        lte: rangeEndUtc
      }
    }
  });
  const pendingRequests = await prisma.meetingRequest.findMany({
    where: {
      cancelledAt: null,
      status: {
        in: [
          MeetingRequestStatus.PENDING_APPROVAL,
          MeetingRequestStatus.RESCHEDULE_PENDING,
          MeetingRequestStatus.SLA_OVERDUE
        ]
      },
      selectedStartAt: {
        not: null,
        lt: rangeEndUtc
      },
      selectedEndAt: {
        not: null,
        gt: rangeStartUtc
      }
    },
    select: {
      selectedStartAt: true,
      selectedEndAt: true
    }
  });
  const meetings = await prisma.meeting.findMany({
    where: {
      cancelledAt: null,
      status: MeetingStatus.SCHEDULED,
      startAt: { lt: rangeEndUtc },
      endAt: { gt: rangeStartUtc }
    },
    select: {
      startAt: true,
      endAt: true
    }
  });
  const requestIntervals = pendingRequests.flatMap((request) =>
    request.selectedStartAt && request.selectedEndAt
      ? [{ startAt: request.selectedStartAt, endAt: request.selectedEndAt }]
      : []
  );
  const meetingIntervals = meetings.map((meeting) => ({
    startAt: meeting.startAt,
    endAt: meeting.endAt
  }));

  return {
    settings,
    now,
    excludedDateKeys: new Set(excludedDates.map((date) => dateKeyFromDbDate(date.date))),
    busyIntervals: [...requestIntervals, ...meetingIntervals, ...externalBusyIntervals]
  };
};
