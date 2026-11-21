import type { Vehicle, ServiceKind } from "../../../shared/types";
export const depot = { x: 850, y: 510 };
/** 每种作业类型的在编车辆数（流程编辑器的排程估算按此供给） */
export const fleetCounts: Record<ServiceKind, number> = {
  fuel: 2,
  baggage: 2,
  clean: 2,
  catering: 1,
  power: 1,
  water: 1,
  deice: 1,
};
export const fleetPrefix: Record<ServiceKind, string> = {
  fuel: "FL",
  baggage: "BG",
  clean: "CL",
  catering: "CT",
  power: "GPU",
  water: "WT",
  deice: "DI",
};
export function initialVehicles(): Vehicle[] {
  const result: Vehicle[] = [];
  (Object.keys(fleetCounts) as ServiceKind[]).forEach((kind) => {
    for (let i = 1; i <= fleetCounts[kind]; i++) {
      const ordinal = result.length,
        col = ordinal % 2,
        row = Math.floor(ordinal / 2);
      const p = { x: 802 + col * 48, y: 420 + row * 24 };
      result.push({
        id: `${fleetPrefix[kind]}-0${i}`,
        kind,
        status: "idle",
        position: p,
        origin: p,
        target: p,
        progress: 0,
        tripDuration: 10,
      });
    }
  });
  return result;
}
export function selectVehicle(
  state: import("../../../shared/types").Shift,
  id: string,
) {
  return { ...state, selectedVehicleId: id };
}
