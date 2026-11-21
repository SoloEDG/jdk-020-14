import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { jobCatalog } from "../../workflow/model/catalog";
import { taskBlockReason } from "../lib/eligibility";

export function dispatchService(
  state: Shift,
  flightId: string,
  taskId: string,
  vehicleId: string,
): Shift {
  const s = copyShift(state),
    v = s.vehicles.find((x) => x.id === vehicleId),
    f = s.flights.find((x) => x.id === flightId),
    stand = s.stands.find((x) => x.id === f?.standId),
    task = s.services.find((x) => x.id === taskId && x.flightId === flightId);
  const reason = task ? taskBlockReason(s, task) : "任务不存在";
  if (
    reason ||
    !v ||
    v.status !== "idle" ||
    !task ||
    v.kind !== task.kind ||
    !stand
  ) {
    s.conflicts++;
    s.score -= 10;
    record(s, reason ?? "车辆不可用或车辆类型不匹配", "warning");
    return s;
  }
  task.status = "travel";
  task.vehicleId = v.id;
  v.status = "travel";
  v.serviceId = task.id;
  v.origin = { ...v.position };
  v.target = { x: stand.x + 42, y: stand.y + 22 };
  v.progress = 0;
  v.tripDuration =
    5 + Math.hypot(v.target.x - v.origin.x, v.target.y - v.origin.y) / 50;
  const info = jobCatalog[task.kind];
  record(
    s,
    `${v.id} → ${flightId} · ${info.label}${task.copyIndex > 0 ? `#${task.copyIndex + 1}` : ""}`,
  );
  return s;
}
