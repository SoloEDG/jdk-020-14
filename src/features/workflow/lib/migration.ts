import type {
  Flight,
  Service,
  WorkflowStep,
  WorkflowVersion,
} from "../../../shared/types";
import { jobCatalog } from "../model/catalog";

export type MigrationCopyKind =
  | "reuse-done" // 已完成成果，直接继承
  | "reuse-active" // 车辆在途/作业中，随车保留
  | "reuse-pending" // 未派遣副本，保留并适用新前置
  | "new" // 新流程新增的副本
  | "removed"; // 旧流程独有、新流程已删除

export interface MigrationCopyPlan {
  copyIndex: number;
  kind: MigrationCopyKind;
  oldStatus?: Service["status"];
  vehicleId?: string;
  /** 新流程为该步骤追加了此前不存在的前置关系 */
  addedPrereq: boolean;
}

export interface MigrationStepPlan {
  stepId: string;
  kind: WorkflowStep["kind"];
  oldCopies: number;
  newCopies: number;
  copies: MigrationCopyPlan[];
  /** 旧版有、新版无 */
  removed: boolean;
  /** 新版有、旧版无 */
  brandNew: boolean;
}

export interface MigrationConflict {
  stepId: string;
  blocking: boolean;
  text: string;
}

export interface MigrationPlan {
  flightId: string;
  fromVersion: number;
  toVersion: number;
  canMigrate: boolean;
  conflicts: MigrationConflict[];
  steps: MigrationStepPlan[];
  doneKept: number;
  activeKept: number;
  created: number;
  dropped: number;
  legacy: number;
}

function prereqSet(step?: WorkflowStep): Set<string> {
  return new Set((step?.prereqs ?? []).map((p) => p.stepId));
}

/**
 * 迁移分析只认 stepId：名称相同但 stepId 不同的步骤按「新增 + 移除」处理，
 * 绝不直接继承成果。
 */
export function planMigration(
  flight: Flight,
  oldTasks: Service[],
  oldVersion: WorkflowVersion,
  newVersion: WorkflowVersion,
): MigrationPlan {
  const oldSteps = new Map(oldVersion.steps.map((s) => [s.id, s]));
  const newSteps = new Map(newVersion.steps.map((s) => [s.id, s]));
  const allIds = new Set([...oldSteps.keys(), ...newSteps.keys()]);
  const conflicts: MigrationConflict[] = [];
  const steps: MigrationStepPlan[] = [];
  let doneKept = 0,
    activeKept = 0,
    created = 0,
    dropped = 0,
    legacy = 0;

  for (const stepId of allIds) {
    const oldStep = oldSteps.get(stepId);
    const newStep = newSteps.get(stepId);
    const group = oldTasks
      .filter((t) => t.stepId === stepId)
      .sort((a, b) => a.copyIndex - b.copyIndex);
    const oldCopies = oldStep?.copies ?? group.length;
    const newCopies = newStep?.copies ?? 0;
    const addedPrereqs = new Set<string>();
    if (oldStep && newStep) {
      const before = prereqSet(oldStep);
      for (const id of prereqSet(newStep)) if (!before.has(id)) addedPrereqs.add(id);
    }
    const copies: MigrationCopyPlan[] = [];
    const maxCopies = Math.max(oldCopies, newCopies);
    for (let i = 0; i < maxCopies; i++) {
      const oldTask = group[i];
      const inNew = !!newStep && i < newCopies;
      if (oldTask && inNew) {
        const kind: MigrationCopyKind =
          oldTask.status === "done"
            ? "reuse-done"
            : oldTask.status === "pending"
              ? "reuse-pending"
              : "reuse-active";
        if (kind === "reuse-done") doneKept++;
        if (kind === "reuse-active") activeKept++;
        if (kind === "reuse-active" && addedPrereqs.size > 0) {
          conflicts.push({
            stepId,
            blocking: false,
            text: `${jobCatalog[oldTask.kind].label}#${i + 1} 已在途（${oldTask.vehicleId}），新增前置不追溯已开工副本，车辆继续完成本次作业`,
          });
        }
        copies.push({
          copyIndex: i,
          kind,
          oldStatus: oldTask.status,
          vehicleId: oldTask.vehicleId,
          addedPrereq: addedPrereqs.size > 0,
        });
      } else if (oldTask && !inNew) {
        copies.push({
          copyIndex: i,
          kind: "removed",
          oldStatus: oldTask.status,
          vehicleId: oldTask.vehicleId,
          addedPrereq: false,
        });
        if (oldTask.status === "done") {
          legacy++;
        } else if (oldTask.status === "pending") {
          dropped++;
        } else {
          conflicts.push({
            stepId,
            blocking: true,
            text: `${jobCatalog[oldTask.kind].label}#${i + 1} 的 ${oldTask.vehicleId} 正在行驶/作业，而新流程已删除该步骤，无法安全撤回车辆`,
          });
        }
      } else {
        copies.push({
          copyIndex: i,
          kind: "new",
          addedPrereq: false,
        });
        created++;
      }
    }
    steps.push({
      stepId,
      kind: (newStep ?? oldStep)!.kind,
      oldCopies,
      newCopies,
      copies,
      removed: !newStep,
      brandNew: !oldStep,
    });
  }

  // 新增前置指向的步骤若尚未完成，提示未开工副本将被卡住等待
  for (const newStep of newVersion.steps) {
    const oldStep = oldSteps.get(newStep.id);
    if (!oldStep) continue;
    const before = prereqSet(oldStep);
    for (const prereqId of prereqSet(newStep)) {
      if (before.has(prereqId)) continue;
      const prereqDone = oldTasks
        .filter((t) => t.stepId === prereqId)
        .every((t) => t.status === "done");
      const hasWaiting = oldTasks.some(
        (t) => t.stepId === newStep.id && t.status === "pending",
      );
      if (hasWaiting && !prereqDone)
        conflicts.push({
          stepId: newStep.id,
          blocking: false,
          text: `新增前置「${prereqId}」尚未完成，${jobCatalog[newStep.kind].label}的未派遣副本将等待其完成后才能派出`,
        });
    }
  }

  return {
    flightId: flight.id,
    fromVersion: oldVersion.version,
    toVersion: newVersion.version,
    canMigrate: !conflicts.some((c) => c.blocking),
    conflicts,
    steps,
    doneKept,
    activeKept,
    created,
    dropped,
    legacy,
  };
}
