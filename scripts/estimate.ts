import assert from "node:assert/strict";
import { simulateSchedule } from "../src/features/workflow/lib/estimate";
import type { WorkflowVersion } from "../src/shared/types";

const fleet = { fuel: 2, baggage: 2, clean: 2, catering: 1, power: 1, water: 1, deice: 1 };
let n = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  n++;
  console.log("✓", name);
};

// any 模式：两个行李副本完成任意一个，清洁即可开始
const anyFlow: WorkflowVersion = {
  version: 1, createdAt: 0, mode: "parallel", maxConcurrent: 4,
  steps: [
    { id: "baggage", kind: "baggage", copies: 2, prereqs: [] },
    { id: "clean", kind: "clean", copies: 1, prereqs: [{ stepId: "baggage", mode: "any" }] },
  ],
};
const allFlow: WorkflowVersion = {
  ...anyFlow,
  steps: [
    { id: "baggage", kind: "baggage", copies: 2, prereqs: [] },
    { id: "clean", kind: "clean", copies: 1, prereqs: [{ stepId: "baggage", mode: "all" }] },
  ],
};
// any 模式：两个行李副本只有一辆车（串行），完成任意一个清洁即可开始
const singleBaggage = { ...fleet, baggage: 1 };
const anySim = simulateSchedule(anyFlow, "narrow", singleBaggage);
const allSim = simulateSchedule(allFlow, "narrow", singleBaggage);
check("any 前置下清洁在第一份行李完成后即可开始",
  anySim.tasks.find((t) => t.stepId === "clean")!.start <
    allSim.tasks.find((t) => t.stepId === "clean")!.start);

// 服务位限制：maxConcurrent=1 等价串行
const one: WorkflowVersion = {
  version: 1, createdAt: 0, mode: "parallel", maxConcurrent: 1,
  steps: [
    { id: "fuel", kind: "fuel", copies: 1, prereqs: [] },
    { id: "power", kind: "power", copies: 1, prereqs: [] },
  ],
};
check("maxConcurrent=1 时峰值为 1", simulateSchedule(one, "narrow", fleet).peakConcurrent === 1);

// 车辆供给受限：只有 1 辆行李车时，两份行李副本必须串行
const limited = simulateSchedule(
  { ...anyFlow, maxConcurrent: 4 },
  "narrow",
  { ...fleet, baggage: 1 },
);
const bTasks = limited.tasks.filter((t) => t.stepId === "baggage").sort((a, b) => a.start - b.start);
check("单车时重复副本串行开始", bTasks[1].start >= bTasks[0].workEnd);
check("车辆需求峰值不超过供给", Object.entries(limited.demand).every(([k, v]) => v! <= fleet[k as keyof typeof fleet]));

// 串行模式下 makespan 等于所有作业（含行驶）累加
const serial = simulateSchedule(allFlow, "narrow", fleet, "serial");
check("串行模式峰值 1", serial.peakConcurrent === 1);
check("串行不早于并行", serial.makespan >= simulateSchedule(allFlow, "narrow", fleet).makespan);

// 宽体机时长系数生效
const narrowTime = simulateSchedule(allFlow, "narrow", fleet).makespan;
const wideTime = simulateSchedule(allFlow, "wide", fleet).makespan;
check("宽体机耗时更长", wideTime > narrowTime);

// 返程占车：1 辆车、3 个无前置同类副本，第二/三个副本必须等前车回到车场
const triple: WorkflowVersion = {
  version: 1, createdAt: 0, mode: "parallel", maxConcurrent: 4,
  steps: [{ id: "power", kind: "power", copies: 3, prereqs: [] }],
};
const tripleSim = simulateSchedule(triple, "narrow", { ...fleet, power: 1 });
const powerTasks = tripleSim.tasks
  .filter((t) => t.stepId === "power")
  .sort((a, b) => a.start - b.start);
check("返程未完成时同辆车不会被重复派发",
  powerTasks[1].start >= powerTasks[0].returnEnd &&
    powerTasks[2].start >= powerTasks[1].returnEnd);
check("单车需求峰值为 1", tripleSim.demand.power === 1);

console.log(`\n排程边界 ${n} 项断言通过`);
