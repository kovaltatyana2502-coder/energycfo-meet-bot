import { describe, expect, it } from "vitest";

import {
  buildAdminStatsReport,
  calculateAverageApprovalMilliseconds,
  calculatePercent,
  formatDurationRu,
  formatPercent,
  type AdminStats
} from "../src/analytics/index.js";

describe("analytics helpers", () => {
  it("calculates average approval time and ignores incomplete records", () => {
    const average = calculateAverageApprovalMilliseconds([
      {
        submittedAt: new Date("2026-05-26T09:00:00.000Z"),
        approvedAt: new Date("2026-05-26T10:00:00.000Z")
      },
      {
        submittedAt: new Date("2026-05-26T09:00:00.000Z"),
        approvedAt: new Date("2026-05-26T12:00:00.000Z")
      },
      {
        submittedAt: new Date("2026-05-26T09:00:00.000Z"),
        approvedAt: null
      }
    ]);

    expect(average).toBe(2 * 60 * 60 * 1000);
  });

  it("formats durations for admin report", () => {
    expect(formatDurationRu(null)).toBe("нет данных");
    expect(formatDurationRu(30 * 1000)).toBe("менее 1 мин");
    expect(formatDurationRu(2 * 60 * 60 * 1000 + 15 * 60 * 1000)).toBe("2 ч 15 мин");
    expect(formatDurationRu(25 * 60 * 60 * 1000)).toBe("1 д 1 ч");
  });

  it("formats conversion percent without division by zero", () => {
    expect(calculatePercent(3, 4)).toBe(75);
    expect(calculatePercent(1, 0)).toBeNull();
    expect(formatPercent(null)).toBe("нет данных");
    expect(formatPercent(74.6)).toBe("75%");
  });

  it("builds Telegram admin statistics report", () => {
    const stats: AdminStats = {
      startedCount: 10,
      submittedCount: 8,
      approvedMeetingsCount: 5,
      declinedCount: 2,
      rescheduledCount: 1,
      cancelledCount: 1,
      slaOverdueCount: 1,
      averageApprovalMilliseconds: 90 * 60 * 1000,
      googleCalendarErrorCount: 0,
      telegramErrorCount: 1,
      technicalErrorCount: 1
    };

    expect(buildAdminStatsReport(stats)).toContain("Статистика за весь период:");
    expect(buildAdminStatsReport(stats)).toContain("Конверсия в заявку: 80%");
    expect(buildAdminStatsReport(stats)).toContain("Среднее время согласования: 1 ч 30 мин");
    expect(buildAdminStatsReport(stats)).toContain("Ошибки Telegram: 1");
  });
});
