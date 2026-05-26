import {
  MeetingRequestKind,
  MeetingRequestStatus,
  NotificationChannel,
  NotificationStatus,
  SystemLogLevel,
  type PrismaClient
} from "@prisma/client";

type ApprovalTiming = {
  submittedAt: Date | null;
  approvedAt: Date | null;
};

export type AdminStats = {
  startedCount: number;
  submittedCount: number;
  approvedMeetingsCount: number;
  declinedCount: number;
  rescheduledCount: number;
  cancelledCount: number;
  slaOverdueCount: number;
  averageApprovalMilliseconds: number | null;
  googleCalendarErrorCount: number;
  telegramErrorCount: number;
  technicalErrorCount: number;
};

export const calculatePercent = (numerator: number, denominator: number) =>
  denominator === 0 ? null : (numerator / denominator) * 100;

export const formatPercent = (value: number | null) => (value === null ? "нет данных" : `${Math.round(value)}%`);

export const calculateAverageApprovalMilliseconds = (items: ApprovalTiming[]) => {
  const durations = items
    .filter((item): item is { submittedAt: Date; approvedAt: Date } => Boolean(item.submittedAt && item.approvedAt))
    .map((item) => item.approvedAt.getTime() - item.submittedAt.getTime())
    .filter((duration) => duration >= 0);

  if (durations.length === 0) {
    return null;
  }

  return durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
};

export const formatDurationRu = (milliseconds: number | null) => {
  if (milliseconds === null) {
    return "нет данных";
  }

  if (milliseconds < 60_000) {
    return "менее 1 мин";
  }

  const totalMinutes = Math.round(milliseconds / 60_000);

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];

  if (days > 0) {
    parts.push(`${days} д`);
  }

  if (hours > 0) {
    parts.push(`${hours} ч`);
  }

  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes} мин`);
  }

  return parts.join(" ");
};

export const buildAdminStatsReport = (stats: AdminStats) =>
  [
    "Статистика за весь период:",
    "",
    `Начатые заявки: ${stats.startedCount}`,
    `Отправленные заявки: ${stats.submittedCount}`,
    `Конверсия в заявку: ${formatPercent(calculatePercent(stats.submittedCount, stats.startedCount))}`,
    `Согласованные встречи: ${stats.approvedMeetingsCount}`,
    `Отказы: ${stats.declinedCount}`,
    `Переносы: ${stats.rescheduledCount}`,
    `Отмены: ${stats.cancelledCount}`,
    `Просроченные по SLA: ${stats.slaOverdueCount}`,
    `Среднее время согласования: ${formatDurationRu(stats.averageApprovalMilliseconds)}`,
    "",
    "Технический контроль:",
    `Ошибки Google Calendar: ${stats.googleCalendarErrorCount}`,
    `Ошибки Telegram: ${stats.telegramErrorCount}`,
    `Технические ошибки: ${stats.technicalErrorCount}`
  ].join("\n");

export const getAdminStats = async (prisma: PrismaClient): Promise<AdminStats> => {
  const [
    startedCount,
    submittedCount,
    approvedMeetingsCount,
    declinedCount,
    rescheduledCount,
    cancelledCount,
    slaOverdueCount,
    approvalTimings,
    googleCalendarErrorCount,
    telegramErrorCount,
    technicalErrorCount
  ] = await Promise.all([
    prisma.meetingRequest.count(),
    prisma.meetingRequest.count({ where: { submittedAt: { not: null } } }),
    prisma.meeting.count(),
    prisma.meetingRequest.count({ where: { status: MeetingRequestStatus.DECLINED } }),
    prisma.meetingRequest.count({
      where: {
        kind: MeetingRequestKind.RESCHEDULE,
        status: MeetingRequestStatus.RESCHEDULED
      }
    }),
    prisma.meetingRequest.count({ where: { status: MeetingRequestStatus.CANCELLED_BY_USER } }),
    prisma.meetingRequest.count({ where: { slaOverdueAt: { not: null } } }),
    prisma.meetingRequest.findMany({
      where: {
        submittedAt: { not: null },
        approvedAt: { not: null }
      },
      select: {
        submittedAt: true,
        approvedAt: true
      }
    }),
    prisma.systemLog.count({
      where: {
        level: SystemLogLevel.ERROR,
        OR: [{ module: { contains: "calendar" } }, { message: { contains: "Google Calendar" } }]
      }
    }),
    prisma.notificationLog.count({
      where: {
        channel: NotificationChannel.TELEGRAM,
        status: NotificationStatus.FAILED
      }
    }),
    prisma.systemLog.count({ where: { level: SystemLogLevel.ERROR } })
  ]);

  return {
    startedCount,
    submittedCount,
    approvedMeetingsCount,
    declinedCount,
    rescheduledCount,
    cancelledCount,
    slaOverdueCount,
    averageApprovalMilliseconds: calculateAverageApprovalMilliseconds(approvalTimings),
    googleCalendarErrorCount,
    telegramErrorCount,
    technicalErrorCount
  };
};
