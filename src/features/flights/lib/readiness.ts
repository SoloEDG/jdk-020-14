import type { Flight, Shift } from "../../../shared/types";
import { pinnedVersionOf } from "../../workflow/model/commands";

/**
 * 离港检查按该航班实际钉住的流程版本判断：
 * 该版本中的每个步骤、每个副本都必须完成；legacy 遗留作业不参与。
 */
export function flightReady(state: Shift, id: string): boolean {
  const flight = state.flights.find((f) => f.id === id);
  if (!flight) return false;
  const version = pinnedVersionOf(state, flight);
  if (!version) return false;
  const tasks = state.services.filter(
    (t) => t.flightId === id && !t.legacy,
  );
  return version.steps.every((step) => {
    const group = tasks.filter((t) => t.stepId === step.id);
    return group.length === step.copies && group.every((t) => t.status === "done");
  });
}

/** 未完成项清单，用于离港按钮提示 */
export function pendingItems(state: Shift, id: string): string[] {
  const flight = state.flights.find((f) => f.id === id);
  const version = flight && pinnedVersionOf(state, flight);
  if (!version) return [];
  const tasks = state.services.filter(
    (t) => t.flightId === id && !t.legacy,
  );
  const missing: string[] = [];
  for (const step of version.steps) {
    const group = tasks.filter((t) => t.stepId === step.id);
    const done = group.filter((t) => t.status === "done").length;
    if (done < step.copies) missing.push(`${step.id}（${done}/${step.copies}）`);
  }
  return missing;
}

export function turnaroundProgress(state: Shift, id: string): number {
  const tasks = state.services.filter(
    (t) => t.flightId === id && !t.legacy,
  );
  return tasks.length
    ? Math.round(tasks.reduce((n, t) => n + t.progress, 0) / tasks.length)
    : 0;
}

export function delaySeconds(flight: Flight, time: number): number {
  return Math.max(
    0,
    Math.floor((flight.departureAt ?? time) - flight.deadline),
  );
}

export const statusLabels: Record<Flight["status"], string> = {
  scheduled: "计划到达",
  incoming: "等待机位",
  parked: "地勤保障",
  departing: "正在推出",
  departed: "已离港",
};
