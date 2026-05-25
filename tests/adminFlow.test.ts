import { describe, expect, it } from "vitest";

import { parseAdminRequestAction } from "../src/bot/adminFlow.js";

describe("admin flow helpers", () => {
  it("parses request card commands", () => {
    expect(parseAdminRequestAction("Заявка #42")).toEqual({
      action: "view",
      requestNumber: 42
    });
  });

  it("parses approval and decline commands", () => {
    expect(parseAdminRequestAction("Согласовать #7")).toEqual({
      action: "approve",
      requestNumber: 7
    });
    expect(parseAdminRequestAction("Отклонить #8")).toEqual({
      action: "decline",
      requestNumber: 8
    });
  });

  it("returns null for unrelated text", () => {
    expect(parseAdminRequestAction("Новые заявки")).toBeNull();
  });
});
