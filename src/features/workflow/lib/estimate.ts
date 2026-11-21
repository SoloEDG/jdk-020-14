import type {
  ServiceKind,
  WorkflowMode,
  WorkflowVersion,
} from "../../../shared/types";
import { jobCatalog, jobDuration } from "../model/catalog";
import { topoOrder } from "./dag";

/** 估算用的平均单程行驶时间（实际游戏中按车场到机位距离计算） */
export const ESTIMATED_OUTBOUND = 12;
export const ESTIMATED_RETURN = 10;

export interface ScheduledTask {
  stepId: string;
  kind: ServiceKind;
  copyIndex: number;
  start: number;
  workEnd: number;
  returnEnd: number;
}

export interface ScheduleEstimate {
  /** 预计完成总时长，车辆缺失时为 Infinity */
  makespan: number;
  peakConcurrent: number;
  /** 每种作业同时被占用的最大车辆数 */
  demand: Partial<Record<ServiceKind, number>>;
  /** 现有车队无法满足的作业类型 */
  shortages: ServiceKind[];
  tasks: ScheduledTask[];
}

interface SimTask extends ScheduledTask {
  duration: number;
  prereqs: { stepId: string; mode: "all" | "any" }[];
  copiesOfStep: number;
  started: boolean;
}

/**
 * 事件驱动排程：
 * - 服务位（并行=maxConcurrent，串行=1）在「前往 + 作业」期间被占用
 * - 车辆在「前往 + 作业 + 返程」期间被占用
 * - conflictsWith 的作业在同一航班上禁止时间重叠
 */
export function simulateSchedule(
  version: WorkflowVersion,
  size: "narrow" | "wide",
  fleet: Record<ServiceKind, number>,
  mode: WorkflowMode = version.mode,
): ScheduleEstimate {
  const order = topoOrder(version.steps) ?? version.steps;
  const rank = new Map(version.steps.map((s, i) => [s.id, i]));
  const slots = mode === "serial" ? 1 : version.maxConcurrent;
  const tasks: SimTask[] = [];
  for (const step of order) {
    for (let i = 0; i < step.copies; i++) {
      tasks.push({
        stepId: step.id,
        kind: step.kind,
        copyIndex: i,
        copiesOfStep: step.copies,
        prereqs: step.prereqs,
        duration: jobDuration(step.kind, size),
        start: -1,
        workEnd: -1,
        returnEnd: -1,
        started: false,
      });
    }
  }
  const shortages = new Set<ServiceKind>();
  for (const t of tasks)
    if ((fleet[t.kind] ?? 0) <= 0) shortages.add(t.kind);
  const demand: Partial<Record<ServiceKind, number>> = {};
  let now = 0;
  let peak = 0;
  const guard = tasks.length * 4 + 4;
  for (let iter = 0; iter < guard && tasks.some((t) => !t.started); iter++) {
    // 服务位只在「前往 + 作业」期间占用（workEnd 后释放）
    const slotUsers = tasks.filter((t) => t.started && t.workEnd > now);
    // 车辆在「前往 + 作业 + 返程」全程占用（returnEnd 后才回库）
    const vehicleUsers = tasks.filter((t) => t.started && t.returnEnd > now);
    const usedKinds: Partial<Record<ServiceKind, number>> = {};
    for (const t of vehicleUsers)
      usedKinds[t.kind] = (usedKinds[t.kind] ?? 0) + 1;
    for (const k of Object.keys(usedKinds) as ServiceKind[])
      demand[k] = Math.max(demand[k] ?? 0, usedKinds[k]!);
    peak = Math.max(peak, slotUsers.length);

    const ready = tasks
      .filter((t) => !t.started)
      .filter((t) =>
        t.prereqs.every((p) => {
          const group = tasks.filter((x) => x.stepId === p.stepId);
          const done = group.filter((x) => x.started && x.workEnd <= now);
          if (group.length === 0) return false;
          return p.mode === "any" ? done.length >= 1 : done.length === group.length;
        }),
      )
      .sort(
        (a, b) =>
          (rank.get(a.stepId) ?? 0) - (rank.get(b.stepId) ?? 0) ||
          b.duration - a.duration,
      );

    let progressed = false;
    for (const t of ready) {
      if (slotUsers.length >= slots) continue;
      if ((fleet[t.kind] ?? 0) <= (usedKinds[t.kind] ?? 0)) continue;
      // 安全互斥只针对仍在机位上的作业，返程中的车辆不阻塞新作业
      if (
        slotUsers.some((o) =>
          jobCatalog[o.kind].conflictsWith.includes(t.kind),
        )
      )
        continue;
      t.started = true;
      t.start = now;
      t.workEnd = now + ESTIMATED_OUTBOUND + t.duration;
      t.returnEnd = t.workEnd + ESTIMATED_RETURN;
      slotUsers.push(t);
      vehicleUsers.push(t);
      usedKinds[t.kind] = (usedKinds[t.kind] ?? 0) + 1;
      progressed = true;
    }
    if (progressed) continue;
    const nextEvent = Math.min(
      ...tasks.filter((t) => t.started && t.returnEnd > now).map((t) =>
        Math.min(
          t.workEnd > now ? t.workEnd : Infinity,
          t.returnEnd > now ? t.returnEnd : Infinity,
        ),
      ),
    );
    if (!Number.isFinite(nextEvent)) break; // 车辆缺失，死锁
    now = nextEvent;
  }
  const unfinished = tasks.some((t) => !t.started);
  const makespan = unfinished
    ? Infinity
    : Math.max(...tasks.map((t) => t.workEnd));
  return {
    makespan,
    peakConcurrent: peak,
    demand,
    shortages: [...shortages],
    tasks: tasks.map(({ started: _s, ...rest }) => rest),
  };
}

export interface ModeComparison {
  parallel: ScheduleEstimate;
  serial: ScheduleEstimate;
}

export function compareModes(
  version: WorkflowVersion,
  size: "narrow" | "wide",
  fleet: Record<ServiceKind, number>,
): ModeComparison {
  return {
    parallel: simulateSchedule(version, size, fleet, "parallel"),
    serial: simulateSchedule(version, size, fleet, "serial"),
  };
}
