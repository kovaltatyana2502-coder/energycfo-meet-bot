import { describe, expect, it } from "vitest";
import { MeetingRequestStatus } from "@prisma/client";

import { canDeclineRequestStatus, parseAdminRequestAction } from "../src/bot/adminFlow.js";

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

  it("parses reschedule approval and decline commands", () => {
    expect(parseAdminRequestAction("Согласовать перенос #9")).toEqual({
      action: "approve",
      requestNumber: 9
    });
    expect(parseAdminRequestAction("Отклонить перенос #10")).toEqual({
      action: "decline",
      requestNumber: 10
    });
  });

  it("returns null for unrelated text", () => {
    expect(parseAdminRequestAction("Новые заявки")).toBeNull();
  });

  it("allows decline for initial and reschedule pending requests", () => {
    expect(canDeclineRequestStatus(MeetingRequestStatus.PENDING_APPROVAL)).toBe(true);
    expect(canDeclineRequestStatus(MeetingRequestStatus.RESCHEDULE_PENDING)).toBe(true);
    expect(canDeclineRequestStatus(MeetingRequestStatus.APPROVED)).toBe(false);
  });
});
