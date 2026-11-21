import assert from "node:assert/strict";
import { createShift } from "../src/features/session/model/shift";
import { assignStand } from "../src/features/flights/model/commands";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift } from "../src/shared/types";

// localStorage 的内存实现，模拟浏览器存档环境
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

const { loadShift, saveShift } = await import(
  "../src/features/session/lib/storage"
);

let passed = 0;
const ok = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  passed++;
  console.log(`✓ ${name}`);
};

// 构造一个 v1 形态的旧存档
const v2 = assignStand(createShift(), "MU2451", "A01");
const v1 = {
  ...v2,
  version: 1,
  flights: v2.flights.map((f) => {
    const { flowId: _a, flowVersion: _b, ...rest } = f;
    return rest;
  }),
  vehicles: v2.vehicles.filter((v) =>
    ["fuel", "baggage", "clean"].includes(v.kind),
  ),
  services: v2.services.map((t) => ({
    id: t.id,
    flightId: t.flightId,
    kind: t.kind,
    status: t.status,
    progress: t.progress,
    duration: t.duration,
    vehicleId: t.vehicleId,
  })),
} as unknown as Record<string, unknown>;
delete (v1 as { workflows?: unknown }).workflows;
store.set("apron07-shift-v1", JSON.stringify(v1));

const upgraded = loadShift() as Shift;
ok("v1 存档可升级恢复", !!upgraded);
ok("升级后版本号为 2", upgraded.version === 2);
ok("升级后通过 v2 严格校验", validShift(upgraded));
const mu = upgraded.flights.find((f) => f.id === "MU2451")!;
ok("已停靠航班补钉流程版本", mu.flowId === "narrow" && mu.flowVersion === 1);
ok("旧作业按 stepId=kind 映射",
  upgraded.services.every((t) => t.stepId === t.kind && t.copyIndex === 0));
ok("未开工航班仍无流程钉住",
  upgraded.flights
    .filter((f) => f.status === "scheduled" || f.status === "incoming")
    .every((f) => f.flowId === undefined));
ok("升级结果已回写到 v2 存储键", store.has("apron07-shift-v2"));

// 无法识别的作业类型必须被丢弃，而不是凭名字猜测
const weird = JSON.parse(JSON.stringify(v1));
(weird.services as unknown[]).push({
  id: "MU2451-ghost-1",
  flightId: "MU2451",
  kind: "ghostwork",
  status: "done",
  progress: 100,
  duration: 10,
});
store.clear();
store.set("apron07-shift-v1", JSON.stringify(weird));
const cleaned = loadShift() as Shift;
ok("未知作业类型在升级时被丢弃",
  cleaned.services.every((t) => t.kind !== "ghostwork"));

// v2 往返
store.clear();
saveShift(createShift());
ok("v2 存档可直接读取", validShift(loadShift()!));

// 损坏的存档返回 undefined 而不是抛异常
store.set("apron07-shift-v2", "{not-json");
ok("损坏存档安全返回 undefined", loadShift() === undefined);

console.log(`\n存档升级 ${passed} 项断言通过`);
