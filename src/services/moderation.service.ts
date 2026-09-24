import { ReportTargetType } from "@prisma/client";
import { prisma } from "../lib/prisma";

/** IDs made unavailable by a moderator. The records are retained for audit. */
export async function disabledTargetIds(targetType: ReportTargetType, targetIds?: string[]) {
  if (targetIds && targetIds.length === 0) return [];
  const actions = await prisma.moderationAction.findMany({ where: { targetType, ...(targetIds ? { targetId: { in: targetIds } } : {}) }, select: { targetId: true } });
  return actions.map((action) => action.targetId);
}

export async function disabledTargetIdsFor(targetTypes: ReportTargetType[], targetIdsByType?: Partial<Record<ReportTargetType, string[]>>) {
  const scopedTypes = targetTypes.filter((type) => targetIdsByType?.[type] === undefined || targetIdsByType[type]!.length > 0);
  const actions = scopedTypes.length ? await prisma.moderationAction.findMany({
    where: { targetType: { in: scopedTypes }, ...(targetIdsByType ? { OR: scopedTypes.filter((type) => targetIdsByType[type] !== undefined).map((type) => ({ targetType: type, targetId: { in: targetIdsByType[type]! } })) } : {}) },
    select: { targetType: true, targetId: true },
  }) : [];
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
