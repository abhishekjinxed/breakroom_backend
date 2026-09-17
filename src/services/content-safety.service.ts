import { prisma } from "../lib/prisma";

type Surface = "Private chat" | "Paper Plane" | "Desk Note" | "Desk Note comment" | "Coffee Break" | "Profile";

const HOUR = 60 * 60 * 1000;

function normalized(value: string) {
  return value.toLowerCase().replace(/[0@]/g, "o").replace(/[1!]/g, "i").replace(/[^a-z0-9]/g, "");
}

function assess(text: string) {
  const plain = text.toLowerCase();
  const compact = normalized(text);
  const childReference = /(child|minor|underage|teen|schoolgirl|schoolboy)/.test(plain);
  const sexualReference = /(sex|nude|naked|porn|explicit|onlyfans|send.*pic)/.test(plain) || /(nudes?|porn|onlyfans)/.test(compact);
  if (childReference && sexualReference) return { allowed: false, serious: true, category: "possible child-safety sexual content" };
  if (/(kill yourself|i will kill|i'll kill|rape you|i will rape|i'll rape)/.test(plain)) return { allowed: false, serious: true, category: "credible threat or violent abuse" };
  if (sexualReference || /(dick|pussy|blowjob|handjob|fuck me)/.test(plain)) return { allowed: false, serious: false, category: "explicit or sexual content" };
  if (/(https?:\/\/|www\.)/.test(plain)) return { allowed: false, serious: false, category: "external links" };
  return { allowed: true, serious: false, category: "" };
}

/** Reject text that does not belong in a work-safe community before it is stored. */
export async function requireSafeText(userId: string, text: string, surface: Surface) {
  const result = assess(text);
  if (result.allowed) return;
  if (result.serious) {
    await prisma.contentReport.create({
      data: {
        reporterId: userId,
        targetType: "USER",
        targetId: userId,
        reason: `Automatic safety flag: ${result.category}`,
        details: `${surface} content was blocked before it could be shared.`,
      },
    });
  }
  throw new Error("UNSAFE_CONTENT");
}

export async function requireRateLimit(userId: string, kind: "plane" | "note" | "comment" | "chat" | "coffee") {
  const now = new Date();
  const since = new Date(now.getTime() - HOUR);
  const limits = { plane: 3, note: 5, comment: 20, chat: 60, coffee: 40 } as const;
  const count = kind === "plane"
    ? await prisma.paperPlaneInvite.count({ where: { senderId: userId, createdAt: { gte: since } } })
    : kind === "note"
      ? await prisma.deskStickyNote.count({ where: { authorId: userId, createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } } })
      : kind === "comment"
        ? await prisma.stickyNoteComment.count({ where: { authorId: userId, createdAt: { gte: since } } })
        : kind === "chat"
          ? await prisma.message.count({ where: { senderId: userId, createdAt: { gte: since } } })
          : await prisma.coffeeBreakMessage.count({ where: { senderId: userId, isSystem: false, createdAt: { gte: since } } });
  if (count >= limits[kind]) throw new Error("RATE_LIMITED");
}

export function safetyErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.message === "UNSAFE_CONTENT") return "That content cannot be shared in Breakroom. Keep it work-safe and non-explicit.";
  if (error.message === "RATE_LIMITED") return "You have reached the posting limit for now. Please try again later.";
  return null;
}
