import pino from "pino";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config/env.js";
import { createServer } from "../src/server/app.js";

describe("health endpoint", () => {
  it("returns backend status without Telegram secrets", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent"
    });
    const server = createServer({
      config,
      logger: pino({ level: "silent" }),
      bot: null
    });

    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "EnergyCFO Meetings Bot",
      timezone: "Europe/Moscow"
    });
  });
});

