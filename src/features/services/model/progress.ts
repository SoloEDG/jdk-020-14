import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { jobCatalog } from "../../workflow/model/catalog";

export function advanceServices(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  for (const task of s.services) {
    if (task.status !== "working") continue;
    task.progress = Math.min(
      100,
      task.progress + (seconds / task.duration) * 100,
    );
    if (task.progress === 100) {
      task.status = "done";
      const v = s.vehicles.find((x) => x.id === task.vehicleId);
      if (v) {
        v.status = "returning";
        v.origin = { ...v.position };
        v.target = { x: 830, y: 480 };
        v.progress = 0;
        v.tripDuration = 10;
      }
      record(
        s,
        `${task.flightId} ${jobCatalog[task.kind].label}${task.copyIndex > 0 ? `#${task.copyIndex + 1}` : ""}完成`,
        "success",
      );
    }
  }
  return s;
}
