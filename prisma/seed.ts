import {
  ActorRole,
  ContactChannel,
  MeetingRequestStatus,
  MeetingTopic,
  PrismaClient
} from "@prisma/client";

const prisma = new PrismaClient();

const seedDemoData = process.env.SEED_DEMO_DATA === "true";

async function main() {
  await prisma.availabilitySettings.upsert({
    where: { key: "default" },
    update: {
      timezone: "Europe/Moscow",
      workingDays: [1, 2, 3, 4, 5],
      workingHoursStart: "10:00",
      workingHoursEnd: "18:00",
      meetingDurationMinutes: 60,
      meetingBufferMinutes: 30,
      meetingMinLeadHours: 12,
      meetingDailyLimit: 5,
      userBookingHorizonMonths: 2,
      adminAvailabilityHorizonMonths: 3,
      isActive: true
    },
    create: {
      key: "default",
      timezone: "Europe/Moscow",
      workingDays: [1, 2, 3, 4, 5],
      workingHoursStart: "10:00",
      workingHoursEnd: "18:00",
      meetingDurationMinutes: 60,
      meetingBufferMinutes: 30,
      meetingMinLeadHours: 12,
      meetingDailyLimit: 5,
      userBookingHorizonMonths: 2,
      adminAvailabilityHorizonMonths: 3,
      isActive: true
    }
  });

  if (!seedDemoData) {
    return;
  }

  const user = await prisma.user.upsert({
    where: { telegramId: "demo-telegram-user" },
    update: {
      fullName: "Тестовый пользователь",
      company: "Тестовая компания",
      position: "Финансовый директор",
      email: "demo@example.com"
    },
    create: {
      telegramId: "demo-telegram-user",
      telegramUsername: "demo_energycfo_user",
      fullName: "Тестовый пользователь",
      company: "Тестовая компания",
      position: "Финансовый директор",
      email: "demo@example.com",
      consentGivenAt: new Date()
    }
  });

  const existingRequest = await prisma.meetingRequest.findFirst({
    where: {
      userId: user.id,
      topic: MeetingTopic.TARIFF_CAMPAIGN,
      status: MeetingRequestStatus.PENDING_APPROVAL
    }
  });

  if (existingRequest) {
    return;
  }

  const meetingRequest = await prisma.meetingRequest.create({
    data: {
      userId: user.id,
      status: MeetingRequestStatus.PENDING_APPROVAL,
      topic: MeetingTopic.TARIFF_CAMPAIGN,
      topicText: "Тарифная кампания",
      comment: "Демо-заявка для проверки сценария согласования.",
      selectedStartAt: new Date("2026-06-01T07:00:00.000Z"),
      selectedEndAt: new Date("2026-06-01T08:00:00.000Z"),
      submittedAt: new Date()
    }
  });

  await prisma.contactPreference.create({
    data: {
      userId: user.id,
      meetingRequestId: meetingRequest.id,
      channel: ContactChannel.TELEGRAM,
      value: "@demo_energycfo_user",
      isPrimary: true
    }
  });

  await prisma.statusHistory.create({
    data: {
      meetingRequestId: meetingRequest.id,
      oldStatus: MeetingRequestStatus.DRAFT,
      newStatus: MeetingRequestStatus.PENDING_APPROVAL,
      actorRole: ActorRole.USER,
      reason: "Демо-заявка создана seed-скриптом"
    }
  });
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
