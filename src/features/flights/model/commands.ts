import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { latestVersion } from "../../workflow/model/catalog";
import { instantiateServices } from "../../workflow/model/commands";
import { flightReady } from "../lib/readiness";

export function assignStand(state: Shift, id: string, standId: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === id),
    stand = s.stands.find((x) => x.id === standId);
  if (!f || !stand) return state;
  const occupied = s.flights.some(
    (x) => x.standId === standId && x.status !== "departed",
  );
  if (
    f.status !== "incoming" ||
    occupied ||
    (f.size === "wide" && stand.size !== "wide")
  ) {
    s.conflicts++;
    s.score -= 10;
    record(s, "机位指令冲突：请检查尺寸、占用与航班状态", "warning");
    return s;
  }
  // 开工瞬间钉住当前最新流程版本，此后模板再发布新版本也不影响本机
  const template = s.workflows.templates.find((t) => t.id === f.size);
  if (!template) {
    record(s, "机位指令冲突：缺少该机型的保障流程", "warning");
    return s;
  }
  const version = latestVersion(template);
  f.standId = standId;
  f.status = "parked";
  f.flowId = template.id;
  f.flowVersion = version.version;
  s.selectedStandId = standId;
  s.services.push(...instantiateServices(s, f, version));
  record(
    s,
    `${id} 已停靠 ${standId}，按 ${template.label} v${version.version} 生成 ${version.steps.reduce((n, step) => n + step.copies, 0)} 项作业`,
    "success",
  );
  return s;
}

export function departFlight(state: Shift, id: string): Shift {
  const s = copyShift(state),
    f = s.flights.find((x) => x.id === id);
  if (!f) return state;
  if (f.status !== "parked" || !flightReady(s, id)) {
    record(s, "离港未获许可：请按该机实际流程完成全部作业", "warning");
    return s;
  }
  f.status = "departing";
  f.departureAt = s.time;
  const delay = Math.max(0, s.time - f.deadline);
  const points = Math.max(20, 120 - Math.floor(delay));
  s.score += points;
  record(
    s,
    `${id} 获准推出（流程 v${f.flowVersion} 全部完成） · +${points} 分`,
    "success",
  );
  return s;
}

export function selectFlight(state: Shift, id: string): Shift {
  return {
    ...state,
    selectedFlightId: id,
    selectedStandId: state.flights.find((f) => f.id === id)?.standId,
  };
}
