import type { Shift, Service } from "../../../shared/types";
import { jobCatalog } from "../../workflow/model/catalog";
import { pinnedVersionOf } from "../../workflow/model/commands";

export { jobCatalog };

/** 该航班当前实际采用的流程版本；未开工航班取所属机型模板的最新版 */
export function effectiveVersion(state: Shift, flightId: string) {
  const flight = state.flights.find((f) => f.id === flightId);
  if (!flight) return undefined;
  if (flight.flowId) return pinnedVersionOf(state, flight);
  const template = state.workflows.templates.find((t) => t.id === flight.size);
  return template?.versions[template.versions.length - 1];
}

export function flightTasks(state: Shift, flightId: string): Service[] {
  return state.services
    .filter((t) => t.flightId === flightId && !t.legacy)
    .sort((a, b) => a.copyIndex - b.copyIndex);
}

export function taskBlockReason(
  s: Shift,
  task: Service,
): string | undefined {
  const f = s.flights.find((x) => x.id === task.flightId);
  if (!f || f.status !== "parked") return "请先分配机位";
  if (task.status !== "pending") return "任务已派遣";
  const version = pinnedVersionOf(s, f);
  if (!version) return "航班未绑定保障流程";
  const step = version.steps.find((x) => x.id === task.stepId);
  if (!step) return `流程 v${task.flowVersion} 中找不到步骤 ${task.stepId}`;

  // 有条件的前置关系：all 需要全部副本完成，any 至少一个副本完成
  for (const prereq of step.prereqs) {
    const group = s.services.filter(
      (t) =>
        t.flightId === f.id &&
        t.stepId === prereq.stepId &&
        !t.legacy,
    );
    const done = group.filter((t) => t.status === "done").length;
    if (prereq.mode === "all" ? done !== group.length || group.length === 0 : done < 1)
      return `等待前置「${prereq.stepId}」${prereq.mode === "all" ? "全部" : "任一"}完成`;
  }

  const active = s.services.filter(
    (t) =>
      t.flightId === f.id &&
      !t.legacy &&
      (t.status === "travel" || t.status === "working"),
  );
  if (active.length >= version.maxConcurrent)
    return `机位 ${version.maxConcurrent} 个服务位均已占用`;

  // 同时作业安全限制：互斥作业类型禁止并行
  const conflicted = active.find((o) =>
    jobCatalog[o.kind].conflictsWith.includes(task.kind),
  );
  if (conflicted)
    return `安全限制：${jobCatalog[conflicted.kind].label}作业期间禁止${jobCatalog[task.kind].label}`;
  return undefined;
}
