import { statfs } from "node:fs/promises";

import {
  ActorRole,
  NotificationStatus,
  NotificationType,
  Prisma,
  SystemLogLevel,
  type PrismaClient
} from "@prisma/client";

import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";

type TelegramTransport = {
  sendMessage(chatId: string, text: string): Promise<unknown>;
};

type OperationsOptions = {
  config: AppConfig;
  logger: AppLogger;
  prisma: PrismaClient;
  telegram?: TelegramTransport | null;
};

type TechnicalErrorInput = {
  module: string;
  action: string;
  message: string;
  error?: unknown;
  meetingRequestId?: string;
  metadata?: Prisma.InputJsonValue;
  dedupeKey?: string;
  notifyAdmin?: boolean;
};

type DiskSpaceRaw = {
  blocks: number;
  availableBlocks: number;
  blockSize: number;
};

export type DiskSpaceStatus = {
  totalBytes: number;
  availableBytes: number;
  freePercent: number;
};

export type OperationsCheckStats = {
  diskFreePercent: number | null;
  diskAlertSent: boolean;
  prunedSystemLogs: number;
};

export const redactSensitiveText = (value: string) =>
  value
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[REDACTED]")
    .replace(/(TELEGRAM_BOT_TOKEN|GOOGLE_CLIENT_SECRET|GOOGLE_REFRESH_TOKEN|DATABASE_URL)=\S+/gi, "$1=[REDACTED]")
    .replace(/postgresql:\/\/([^:\s]+):([^@\s]+)@/gi, "postgresql://$1:[REDACTED]@");

const normalizeErrorMessage = (error: unknown) => {
  if (!error) {
    return null;
  }

  if (error instanceof Error) {
    return redactSensitiveText(error.message);
  }

  return redactSensitiveText(String(error));
};

export const formatTechnicalAlert = (input: Pick<TechnicalErrorInput, "module" | "action" | "message" | "error">) => {
  const errorMessage = normalizeErrorMessage(input.error);
  const lines = [
    "Техническое уведомление EnergyCFO.",
    "",
    `Модуль: ${input.module}`,
    `Действие: ${input.action}`,
    `Сообщение: ${redactSensitiveText(input.message)}`
  ];

  if (errorMessage) {
    lines.push(`Ошибка: ${errorMessage}`);
  }

  return lines.join("\n").slice(0, 3500);
};

const isUniqueConstraintError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

const createTechnicalNotificationLog = async (
  prisma: PrismaClient,
  input: {
    recipientTelegramId: string;
    dedupeKey?: string;
  }
) => {
  const data: Prisma.NotificationLogUncheckedCreateInput = {
    type: NotificationType.TECHNICAL_ERROR,
    recipientRole: ActorRole.ADMIN,
    recipientTelegramId: input.recipientTelegramId,
    status: NotificationStatus.PENDING
  };

  if (input.dedupeKey) {
    data.dedupeKey = input.dedupeKey;
  }

  try {
    return await prisma.notificationLog.create({ data });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return null;
    }

    throw error;
  }
};

const sendAdminTechnicalNotification = async (
  options: OperationsOptions,
  input: TechnicalErrorInput
) => {
  const notificationInput: { recipientTelegramId: string; dedupeKey?: string } = {
    recipientTelegramId: options.config.telegram.adminId
  };

  if (input.dedupeKey) {
    notificationInput.dedupeKey = input.dedupeKey;
  }

  const log = await createTechnicalNotificationLog(options.prisma, notificationInput);

  if (!log) {
    return false;
  }

  if (!options.telegram) {
    await options.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.SKIPPED,
        errorMessage: "Telegram transport is not configured"
      }
    });
    return false;
  }

  try {
    await options.telegram.sendMessage(options.config.telegram.adminId, formatTechnicalAlert(input));
    await options.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.SENT,
        sentAt: new Date()
      }
    });
    return true;
  } catch (error) {
    await options.prisma.notificationLog.update({
      where: { id: log.id },
      data: {
        status: NotificationStatus.FAILED,
        errorMessage: normalizeErrorMessage(error) ?? "Unknown Telegram error"
      }
    });
    options.logger.warn({ error }, "Failed to send technical notification to admin");
    return false;
  }
};

export const recordTechnicalError = async (options: OperationsOptions, input: TechnicalErrorInput) => {
  const systemLogData: Prisma.SystemLogUncheckedCreateInput = {
    level: SystemLogLevel.ERROR,
    module: input.module,
    action: input.action,
    message: redactSensitiveText(input.message)
  };
  const errorMessage = normalizeErrorMessage(input.error);

  if (input.meetingRequestId) {
    systemLogData.meetingRequestId = input.meetingRequestId;
  }

  if (input.metadata) {
    systemLogData.metadata = input.metadata;
  }

  if (errorMessage) {
    systemLogData.metadata = {
      ...(typeof input.metadata === "object" && input.metadata && !Array.isArray(input.metadata) ? input.metadata : {}),
      errorMessage
    };
  }

  const systemLog = await options.prisma.systemLog.create({
    data: systemLogData
  });

  options.logger.error(
    {
      module: input.module,
      action: input.action,
      systemLogId: systemLog.id
    },
    redactSensitiveText(input.message)
  );

  const adminNotified =
    input.notifyAdmin === false ? false : await sendAdminTechnicalNotification(options, input);

  return {
    systemLogId: systemLog.id,
    adminNotified
  };
};

export const calculateDiskSpaceStatus = ({ blocks, availableBlocks, blockSize }: DiskSpaceRaw): DiskSpaceStatus => {
  const totalBytes = blocks * blockSize;
  const availableBytes = availableBlocks * blockSize;

  return {
    totalBytes,
    availableBytes,
    freePercent: totalBytes === 0 ? 0 : (availableBytes / totalBytes) * 100
  };
};

export const getDiskSpaceStatus = async (path = process.cwd()) => {
  const stats = await statfs(path);

  return calculateDiskSpaceStatus({
    blocks: stats.blocks,
    availableBlocks: stats.bavail,
    blockSize: stats.bsize
  });
};

const toDateKey = (date: Date) => date.toISOString().slice(0, 10);

const checkDiskSpace = async (options: OperationsOptions, now: Date) => {
  const disk = await getDiskSpaceStatus();

  if (disk.freePercent >= options.config.operations.minFreeDiskPercent) {
    return {
      disk,
      alertSent: false
    };
  }

  const alertSent = (
    await recordTechnicalError(options, {
      module: "operations",
      action: "disk_space_low",
      message: `Свободное место на диске ниже порога: ${disk.freePercent.toFixed(1)}%`,
      metadata: {
        freePercent: disk.freePercent,
        minFreeDiskPercent: options.config.operations.minFreeDiskPercent,
        availableBytes: disk.availableBytes,
        totalBytes: disk.totalBytes
      },
      dedupeKey: `operations:disk-space-low:${toDateKey(now)}`
    })
  ).adminNotified;

  return {
    disk,
    alertSent
  };
};

const pruneOldSystemLogs = async (prisma: PrismaClient, retentionDays: number, now: Date) => {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const result = await prisma.systemLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoff
      }
    }
  });

  return result.count;
};

export const runOperationsChecksOnce = async (
  options: OperationsOptions,
  now = new Date()
): Promise<OperationsCheckStats> => {
  let diskFreePercent: number | null = null;
  let diskAlertSent = false;

  try {
    const diskCheck = await checkDiskSpace(options, now);
    diskFreePercent = diskCheck.disk.freePercent;
    diskAlertSent = diskCheck.alertSent;
  } catch (error) {
    await recordTechnicalError(options, {
      module: "operations",
      action: "disk_space_check_failed",
      message: "Не удалось проверить свободное место на диске",
      error,
      dedupeKey: `operations:disk-space-check-failed:${toDateKey(now)}`
    });
  }

  const prunedSystemLogs = await pruneOldSystemLogs(options.prisma, options.config.operations.logRetentionDays, now);

  return {
    diskFreePercent,
    diskAlertSent,
    prunedSystemLogs
  };
};
