import { ContactChannel, MeetingTopic } from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  isValidEmail,
  normalizeText,
  parseContactChannel,
  parseTopicChoice,
  parseUserMeetingAction
} from "../src/bot/bookingFlow.js";

describe("booking flow helpers", () => {
  it("normalizes user text", () => {
    expect(normalizeText("  Тарифная   кампания  ")).toBe("Тарифная кампания");
  });

  it("validates email format", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
    expect(isValidEmail("user@example")).toBe(false);
  });

  it("parses topic choices", () => {
    expect(parseTopicChoice("Тарифная кампания")).toEqual({
      topic: MeetingTopic.TARIFF_CAMPAIGN,
      topicText: "Тарифная кампания"
    });
  });

  it("parses contact channel choices", () => {
    expect(parseContactChannel("WhatsApp")).toBe(ContactChannel.WHATSAPP);
    expect(parseContactChannel("Телефон")).toBe(ContactChannel.PHONE);
  });

  it("parses user meeting lifecycle commands", () => {
    expect(parseUserMeetingAction("Отменить встречу #12")).toEqual({
      action: "cancel",
      requestNumber: 12
    });
    expect(parseUserMeetingAction("Да, отменить #12")).toEqual({
      action: "confirm_cancel",
      requestNumber: 12
    });
    expect(parseUserMeetingAction("Перенести встречу #12")).toEqual({
      action: "reschedule",
      requestNumber: 12
    });
  });
});
