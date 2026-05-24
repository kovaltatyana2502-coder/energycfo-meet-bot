import { describe, expect, it } from "vitest";

import { isPlaceholderSecret, loadConfig } from "../src/config/env.js";

describe("environment config", () => {
  it("parses Telegram polling settings", () => {
    const config = loadConfig({
      TELEGRAM_RUN_MODE: "polling",
      TELEGRAM_DROP_PENDING_UPDATES: "false"
    });

    expect(config.telegram.runMode).toBe("polling");
    expect(config.telegram.dropPendingUpdates).toBe(false);
  });

  it("treats local token placeholders as missing secrets", () => {
    expect(isPlaceholderSecret("replace_me")).toBe(true);
    expect(isPlaceholderSecret("PASTE_TELEGRAM_BOT_TOKEN_HERE")).toBe(true);
    expect(isPlaceholderSecret("123:token")).toBe(false);
  });
});

