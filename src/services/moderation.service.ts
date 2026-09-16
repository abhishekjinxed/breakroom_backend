import { ReportTargetType } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** IDs made unavailable by a moderator. The records are retained for audit. */
export async function disabledTargetIds(targetType: ReportTargetType) {
  const actions = await prisma.moderationAction.findMany({ where: { targetType }, select: { targetId: true } });
  return actions.map((action) => action.targetId);
}

export async function disabledTargetIdsFor(targetTypes: ReportTargetType[]) {
  const actions = await prisma.moderationAction.findMany({ where: { targetType: { in: targetTypes } }, select: { targetType: true, targetId: true } });
  return targetTypes.reduce((result, targetType) => {
    result[targetType] = actions.filter((action) => action.targetType === targetType).map((action) => action.targetId);
    return result;
  }, {} as Record<ReportTargetType, string[]>);
}

/** Public replacement copy. Original text/media must never be returned once
 * a moderation action is in effect, but keeping a placeholder preserves the
 * conversation or feed context in the same way Reddit does. */
export function moderatorRemovalText() {
  return "Removed by a moderator.";
}

export function authorRemovalText() {
  return "Deleted by the author.";
}
