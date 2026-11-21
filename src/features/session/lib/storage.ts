import type {
  Service,
  ServiceKind,
  Shift,
  WorkflowStore,
  Flight,
} from "../../../shared/types";
import { defaultTemplates, jobCatalog } from "../../workflow/model/catalog";
import { validShift } from "./validation";

const key = "apron07-shift-v2";
const legacyKey = "apron07-shift-v1";

export function saveShift(state: Shift): void {
  localStorage.setItem(key, JSON.stringify(state));
}

/**
 * v1 存档升级：旧版每个航班固定三种作业且 id 为 `${flight}-${kind}`，
 * stepId 与 kind 同名，可安全映射；流程归属补钉为默认 v1。
 * 无法识别的作业类型直接丢弃，绝不凭名称猜测含义。
 */
function upgradeV1(raw: Record<string, unknown>): Shift | undefined {
  try {
    const workflows: WorkflowStore = { templates: defaultTemplates() };
    const knownKinds = new Set(Object.keys(jobCatalog) as ServiceKind[]);
    const flights = (raw.flights as Record<string, unknown>[]).map(
      (f): Flight => ({
        ...(f as Omit<Flight, "flowId" | "flowVersion">),
        flowId: undefined,
        flowVersion: undefined,
      }),
    );
    const parkedIds = new Set(
      flights
        .filter(
          (f) =>
            f.status === "parked" ||
            f.status === "departing" ||
            f.status === "departed",
        )
        .map((f) => f.id),
    );
    for (const f of flights) {
      if (parkedIds.has(f.id)) {
        f.flowId = f.size;
        f.flowVersion = 1;
      }
    }
    const services: Service[] = [];
    for (const old of raw.services as Record<string, unknown>[]) {
      const kind = old.kind as ServiceKind;
      const flightId = old.flightId as string;
      if (!knownKinds.has(kind)) continue;
      const flight = flights.find((f) => f.id === flightId);
      const service = {
        id: old.id as string,
        flightId,
        stepId: kind,
        copyIndex: 0,
        kind,
        flowId: parkedIds.has(flightId) ? flight?.size : undefined,
        flowVersion: parkedIds.has(flightId) ? 1 : undefined,
        status: old.status as Service["status"],
        progress: old.progress as number,
        duration: old.duration as number,
        vehicleId: old.vehicleId as string | undefined,
      } as Service;
      services.push(service);
    }
    const upgraded: Shift = {
      ...(raw as unknown as Shift),
      version: 2,
      flights: flights as Shift["flights"],
      services,
      workflows,
    };
    return validShift(upgraded) ? upgraded : undefined;
  } catch {
    return undefined;
  }
}

export function loadShift(): Shift | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (validShift(value)) return value;
      return undefined;
    }
    // 兼容旧版本存档
    const legacy = localStorage.getItem(legacyKey);
    if (legacy) {
      const value = JSON.parse(legacy) as Record<string, unknown>;
      if (value.version !== 1) return undefined;
      const upgraded = upgradeV1(value);
      if (upgraded) localStorage.setItem(key, JSON.stringify(upgraded));
      return upgraded;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
