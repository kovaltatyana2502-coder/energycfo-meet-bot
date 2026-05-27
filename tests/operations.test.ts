import { describe, expect, it } from "vitest";

import {
  calculateDiskSpaceStatus,
  formatTechnicalAlert,
  redactSensitiveText
} from "../src/operations/index.js";

describe("operations helpers", () => {
  it("redacts sensitive values from technical messages", () => {
    const text =
      "request to https://api.telegram.org/bot123456:secret_token/sendMessage failed DATABASE_URL=postgresql://user:pass@localhost:5432/db";

    expect(redactSensitiveText(text)).not.toContain("secret_token");
    expect(redactSensitiveText(text)).not.toContain("pass@localhost");
    expect(redactSensitiveText(text)).toContain("bot[REDACTED]");
    expect(redactSensitiveText(text)).toContain("DATABASE_URL=[REDACTED]");
  });

  it("formats technical alert for admin without raw token", () => {
    const message = formatTechnicalAlert({
      module: "telegram",
      action: "handler_failed",
      message: "Failed with TELEGRAM_BOT_TOKEN=123",
      error: new Error("https://api.telegram.org/bot123456:secret_token/getUpdates")
    });

    expect(message).toContain("Техническое уведомление EnergyCFO.");
    expect(message).toContain("Модуль: telegram");
    expect(message).not.toContain("secret_token");
    expect(message).not.toContain("TELEGRAM_BOT_TOKEN=123");
  });

  it("calculates free disk percentage", () => {
    const status = calculateDiskSpaceStatus({
      blocks: 100,
      availableBlocks: 25,
      blockSize: 1024
    });

    expect(status.totalBytes).toBe(102400);
    expect(status.availableBytes).toBe(25600);
    expect(status.freePercent).toBe(25);
  });
});
