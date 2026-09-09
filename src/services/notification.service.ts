import { AppNotificationType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { notifyAppNotification } from "../socket";

type CreateNotificationInput = {
  userId: string;
  type: AppNotificationType;
  title: string;
  detail: string;
  link?: string;
};

async function sendAndroidPush(userId: string, title: string, detail: string, link?: string) {
  const devices = await prisma.pushDevice.findMany({ where: { userId, platform: "android" }, select: { token: true } });
  if (!devices.length) return;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(devices.map((device) => ({ to: device.token, title, body: detail, sound: "default", channelId: "breakroom", priority: "high", data: { url: link ?? "/notifications" } }))),
    });
    const payload = await response.json().catch(() => null) as { data?: Array<{ status?: string; details?: { error?: string } }> } | null;
    const invalidTokens = devices.filter((_, index) => payload?.data?.[index]?.details?.error === "DeviceNotRegistered").map((device) => device.token);
    if (invalidTokens.length) await prisma.pushDevice.deleteMany({ where: { token: { in: invalidTokens } } });
  } catch (error) {
    console.warn("PUSH DELIVERY ERROR:", error);
  }
}

export async function createAppNotification(input: CreateNotificationInput) {
  const notification = await prisma.appNotification.create({ data: input });
  notifyAppNotification(input.userId, {
    id: notification.id,
    title: notification.title,
    detail: notification.detail,
    link: notification.link,
    createdAt: notification.createdAt,
  });
  void sendAndroidPush(input.userId, notification.title, notification.detail, notification.link ?? undefined);
  return notification;
}
