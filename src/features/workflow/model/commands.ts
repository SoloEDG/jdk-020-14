import type {
  Flight,
  Service,
  Shift,
  WorkflowTemplate,
  WorkflowVersion,
} from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { jobDuration, latestVersion } from "./catalog";
import { hasBlockingErrors, validateWorkflow } from "../lib/dag";
import type { WorkflowDraft } from "./editor";
import { planMigration } from "../lib/migration";

export function publishWorkflow(
  state: Shift,
  templateId: string,
  draft: WorkflowDraft,
): Shift {
  const issues = validateWorkflow({ ...draft, version: 0, createdAt: 0 });
  if (hasBlockingErrors(issues)) {
    const s = copyShift(state);
    s.conflicts++;
    s.score -= 10;
    record(s, `流程发布被阻止：${issues.find((i) => i.level === "error")?.text}`, "warning");
    return s;
  }
  const s = copyShift(state);
  const template = s.workflows.templates.find((t) => t.id === templateId);
  if (!template) return state;
  const previous = latestVersion(template);
  const next: WorkflowVersion = {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      prereqs: step.prereqs.map((p) => ({ ...p })),
    })),
    version: previous.version + 1,
    createdAt: s.time,
  };
  template.versions.push(next);
  const pending = s.flights.filter((f) => f.status === "scheduled" || f.status === "incoming");
  record(
    s,
    `${template.label} 已发布 v${next.version}，将默认用于 ${pending.length} 架尚未开工的航班`,
    "success",
  );
  return s;
}

/** 按钉住的流程版本为新停靠航班实例化作业任务 */
export function instantiateServices(
  state: Shift,
  flight: Flight,
  version: WorkflowVersion,
): Service[] {
  const services: Service[] = [];
  for (const step of version.steps) {
    for (let copyIndex = 0; copyIndex < step.copies; copyIndex++) {
      services.push({
        id: `${flight.id}-${step.id}-${copyIndex + 1}`,
        flightId: flight.id,
        stepId: step.id,
        copyIndex,
        kind: step.kind,
        flowId: flight.flowId!,
        flowVersion: flight.flowVersion!,
        status: "pending",
        progress: 0,
        duration: jobDuration(step.kind, flight.size),
      });
    }
  }
  return services;
}

/** 已开工航班迁移到新版本；调用方应先确认 plan.canMigrate */
export function migrateFlight(
  state: Shift,
  flightId: string,
  toVersion: number,
): Shift {
  const s = copyShift(state);
  const flight = s.flights.find((f) => f.id === flightId);
  if (!flight || !flight.flowId) return state;
  const template = s.workflows.templates.find((t) => t.id === flight.flowId);
  const oldVersion = template?.versions.find((v) => v.version === flight.flowVersion);
  const newVersion = template?.versions.find((v) => v.version === toVersion);
  if (!template || !oldVersion || !newVersion || oldVersion === newVersion)
    return state;

  const oldTasks = s.services.filter((t) => t.flightId === flightId);
  const plan = planMigration(flight, oldTasks, oldVersion, newVersion);
  if (!plan.canMigrate) {
    s.conflicts++;
    s.score -= 10;
    record(
      s,
      `${flightId} 无法迁移至 v${toVersion}：${plan.conflicts.find((c) => c.blocking)?.text}`,
      "warning",
    );
    return s;
  }

  const newStepIds = new Set(newVersion.steps.map((step) => step.id));
  const newCopies = new Map(
    newVersion.steps.map((step) => [step.id, step.copies]),
  );
  const result: Service[] = [];
  for (const task of oldTasks) {
    if (newStepIds.has(task.stepId)) {
      // 副本数量缩减：超出新版数量的未派遣副本丢弃；在途副本属阻断冲突，不会走到这里
      if (task.copyIndex >= (newCopies.get(task.stepId) ?? 0)) {
        if (task.status === "done") {
          task.legacy = true;
          result.push(task);
        }
        continue;
      }
      task.flowVersion = toVersion;
      result.push(task);
      continue;
    }
    if (task.status === "done") {
      // 已完成成果保留备查：标记 legacy，并保留它完成时的旧版本号，
      // 不再参与新版离港检查
      task.legacy = true;
      result.push(task);
    }
    // 未派遣且被删除的副本直接丢弃；在途副本属于阻断冲突，不会走到这里
  }
  const existing = new Set(result.map((t) => `${t.stepId}#${t.copyIndex}`));
  for (const step of newVersion.steps) {
    for (let copyIndex = 0; copyIndex < step.copies; copyIndex++) {
      if (existing.has(`${step.id}#${copyIndex}`)) continue;
      result.push({
        id: `${flight.id}-${step.id}-${copyIndex + 1}`,
        flightId: flight.id,
        stepId: step.id,
        copyIndex,
        kind: step.kind,
        flowId: template.id,
        flowVersion: toVersion,
        status: "pending",
        progress: 0,
        duration: jobDuration(step.kind, flight.size),
      });
    }
  }
  s.services = s.services
    .filter((t) => t.flightId !== flightId)
    .concat(result);
  flight.flowVersion = toVersion;
  record(
    s,
    `${flightId} 已迁移至流程 v${toVersion}：保留成果 ${plan.doneKept} 项、在途车辆 ${plan.activeKept} 辆，新增作业 ${plan.created} 项`,
    "success",
  );
  for (const conflict of plan.conflicts)
    record(s, `${flightId} 迁移提示：${conflict.text}`);
  return s;
}

export function pinnedVersionOf(
  state: Shift,
  flight: Flight,
): WorkflowVersion | undefined {
  if (!flight.flowId) return undefined;
  const template: WorkflowTemplate | undefined = state.workflows.templates.find(
    (t) => t.id === flight.flowId,
  );
  return template?.versions.find((v) => v.version === flight.flowVersion);
}
