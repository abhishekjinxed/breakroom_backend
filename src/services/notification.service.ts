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

export async function createAppNotification(input: CreateNotificationInput) {
  const notification = await prisma.appNotification.create({ data: input });
  notifyAppNotification(input.userId, {
    id: notification.id,
    title: notification.title,
    detail: notification.detail,
    link: notification.link,
    createdAt: notification.createdAt,
  });
  return notification;
}
