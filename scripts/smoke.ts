import assert from "node:assert/strict";
import { createShift } from "../src/features/session/model/shift";
import { assignStand, departFlight } from "../src/features/flights/model/commands";
import { dispatchService } from "../src/features/services/model/dispatch";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { advanceClock } from "../src/features/session/model/clock";
import {
  validateWorkflow,
  cycleMembers,
  topoOrder,
  publishWorkflow,
  migrateFlight,
  planMigration,
  simulateSchedule,
  draftFromVersion,
  latestVersion,
  jobCatalog,
} from "../src/features/workflow";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift, WorkflowVersion } from "../src/shared/types";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log(`✓ ${name}`);
}

// 1. 默认班次结构
let state = createShift();
ok("v2 存档初始即通过校验", validShift(state));
ok("未开工航班没有任务", state.services.length === 0);
ok("车队 10 辆覆盖 7 类作业", state.vehicles.length === 10);

// 2. 停靠即钉住版本并实例化任务
state = assignStand(state, "MU2451", "A01");
const mu = state.flights.find((f) => f.id === "MU2451")!;
ok("停靠后钉住 narrow v1", mu.flowId === "narrow" && mu.flowVersion === 1);
ok("窄体默认 3 项作业", state.services.filter((t) => t.flightId === "MU2451").length === 3);
ok("停靠后仍通过校验", validShift(state));

// 3. 环检测
const cyclic: WorkflowVersion = {
  version: 9,
  createdAt: 0,
  mode: "parallel",
  maxConcurrent: 2,
  steps: [
    { id: "a", kind: "baggage", copies: 1, prereqs: [{ stepId: "c", mode: "all" }] },
    { id: "b", kind: "clean", copies: 1, prereqs: [{ stepId: "a", mode: "all" }] },
    { id: "c", kind: "fuel", copies: 1, prereqs: [{ stepId: "b", mode: "all" }] },
  ],
};
ok("环被检测到", topoOrder(cyclic.steps) === null);
ok("环成员包含全部三个步骤", cycleMembers(cyclic.steps).size === 3);
ok("环形流程校验报错", validateWorkflow(cyclic).some((i) => i.level === "error"));
const acyclic: WorkflowVersion = {
  ...cyclic,
  steps: [
    { id: "a", kind: "baggage", copies: 1, prereqs: [] },
    { id: "b", kind: "clean", copies: 1, prereqs: [{ stepId: "a", mode: "all" }] },
    { id: "c", kind: "fuel", copies: 1, prereqs: [{ stepId: "b", mode: "any" }] },
  ],
};
ok("无环流程通过校验", !validateWorkflow(acyclic).some((i) => i.level === "error"));

// 4. 自环与悬空引用
const broken: WorkflowVersion = {
  ...acyclic,
  steps: [
    { id: "a", kind: "baggage", copies: 1, prereqs: [{ stepId: "a", mode: "all" }] },
    { id: "b", kind: "clean", copies: 1, prereqs: [{ stepId: "ghost", mode: "all" }] },
  ],
};
ok("自环/悬空引用被拦截", validateWorkflow(broken).filter((i) => i.level === "error").length >= 2);

// 5. 排程估算：并行快于串行；安全互斥阻止并行
const parallel = simulateSchedule(acyclic, "narrow", {
  fuel: 2, baggage: 2, clean: 2, catering: 1, power: 1, water: 1, deice: 1,
});
const serial = simulateSchedule(acyclic, "narrow", {
  fuel: 2, baggage: 2, clean: 2, catering: 1, power: 1, water: 1, deice: 1,
}, "serial");
ok("并行预计完成时间不晚于串行", parallel.makespan <= serial.makespan);
ok("串行峰值只占 1 个服务位", serial.peakConcurrent === 1);

const safety: WorkflowVersion = {
  version: 1,
  createdAt: 0,
  mode: "parallel",
  maxConcurrent: 2,
  steps: [
    { id: "fuel", kind: "fuel", copies: 1, prereqs: [] },
    { id: "deice", kind: "deice", copies: 1, prereqs: [] },
  ],
};
const safetySim = simulateSchedule(safety, "narrow", {
  fuel: 2, baggage: 2, clean: 2, catering: 1, power: 1, water: 1, deice: 1,
});
ok("加油与除冰安全互斥，峰值并行不超过 1", safetySim.peakConcurrent === 1);

const noTruck = simulateSchedule(safety, "narrow", {
  fuel: 0, baggage: 2, clean: 2, catering: 1, power: 1, water: 1, deice: 1,
});
ok("缺车时标记短缺且无法完成", noTruck.shortages.includes("fuel") && noTruck.makespan === Infinity);

// 6. 重复作业（宽体 2 份行李）+ 发布 v2
const wide = latestVersion(state.workflows.templates.find((t) => t.id === "wide")!);
ok("宽体默认行李为 2 副本", wide.steps.find((s) => s.id === "baggage")!.copies === 2);

const narrowTemplateId = "narrow";
const draft = draftFromVersion(
  latestVersion(state.workflows.templates.find((t) => t.id === narrowTemplateId)!),
);
draft.steps.push({
  id: "catering",
  kind: "catering",
  copies: 2,
  prereqs: [{ stepId: "clean", mode: "all" }],
});
state = publishWorkflow(state, narrowTemplateId, draft);
const narrowTemplate = state.workflows.templates.find((t) => t.id === narrowTemplateId)!;
ok("narrow 发布 v2", latestVersion(narrowTemplate).version === 2);
ok("已发布的 v1 保持不可变", narrowTemplate.versions[0].steps.length === 3);

// 7. 新流程默认用于未开工航班（先推进到 HU7602 进港）
while (state.flights.find((f) => f.id === "HU7602")!.status === "scheduled")
  state = advanceClock(state, 5);
state = assignStand(state, "HU7602", "A02");
const hu = state.flights.find((f) => f.id === "HU7602")!;
ok("未开工航班停靠时采用最新 v2", hu.flowVersion === 2);
ok("v2 实例化 5 项作业（含 2 份餐食）",
  state.services.filter((t) => t.flightId === "HU7602").length === 5);

// 8. 已开工航班保留旧版，迁移按 stepId 对齐
ok("已开工的 MU2451 仍钉在 v1", mu.flowVersion === 1);
const oldV1 = narrowTemplate.versions[0];
const newV2 = narrowTemplate.versions[1];
const muTasks = state.services.filter((t) => t.flightId === "MU2451");
const plan = planMigration(mu, muTasks, oldV1, newV2);
ok("迁移计划可执行", plan.canMigrate);
ok("迁移识别出 2 个新增副本", plan.created === 2);
ok("名称/标识相同的三个步骤被识别为继承", plan.doneKept + plan.activeKept + plan.steps.filter((s) => s.copies.some((c) => c.kind === "reuse-pending")).length >= 3);

// 完成一项作业后再迁移，验证成果继承
function runToDone(s: Shift, flightId: string, stepId: string): Shift {
  let cur = s;
  const task = cur.services.find(
    (t) => t.flightId === flightId && t.stepId === stepId && t.status === "pending",
  )!;
  const vehicle = cur.vehicles.find((v) => v.kind === task.kind && v.status === "idle")!;
  cur = dispatchService(cur, flightId, task.id, vehicle.id);
  for (let i = 0; i < 200; i++) {
    cur = advanceServices(advanceFleet(advanceClock(cur, 1), 1), 1);
    const t2 = cur.services.find((x) => x.id === task.id);
    if (t2?.status === "done") break;
  }
  return cur;
}
state = runToDone(state, "MU2451", "baggage");
const doneTask = state.services.find((t) => t.flightId === "MU2451" && t.stepId === "baggage")!;
ok("行李作业已完成", doneTask.status === "done");
const plan2 = planMigration(
  state.flights.find((f) => f.id === "MU2451")!,
  state.services.filter((t) => t.flightId === "MU2451"),
  oldV1,
  newV2,
);
ok("迁移计划继承 1 项已完成成果", plan2.doneKept === 1);
const before = state.services.filter((t) => t.flightId === "MU2451").length;
state = migrateFlight(state, "MU2451", 2);
ok("迁移后版本号更新", state.flights.find((f) => f.id === "MU2451")!.flowVersion === 2);
ok("迁移后作业数 = 旧 3 + 新增 2", state.services.filter((t) => t.flightId === "MU2451").length === before + 2);
const inherited = state.services.find((t) => t.id === doneTask.id)!;
ok("成果按 stepId 继承且保持 done", inherited.status === "done" && inherited.flowVersion === 2);
ok("迁移后存档通过校验", validShift(state));

// 9. 迁移阻断：在途车辆所在步骤被新流程删除
state = runToDone(state, "MU2451", "fuel");
const draft3 = draftFromVersion(newV2);
draft3.steps = draft3.steps.filter((s) => s.id !== "fuel");
state = publishWorkflow(state, "narrow", draft3);
const v3 = latestVersion(
  state.workflows.templates.find((t) => t.id === "narrow")!,
);
// 先迁移到 v3（fuel 已完成 → 成为 legacy 遗留成果）
state = migrateFlight(state, "MU2451", v3.version);
ok("迁移到 v3 后旧 fuel 成果标记为 legacy",
  state.services.some((t) => t.flightId === "MU2451" && t.stepId === "fuel" && t.legacy && t.status === "done"));
// 派遣清洁车进入在途状态
const cleanTask = state.services.find(
  (t) => t.flightId === "MU2451" && t.stepId === "clean" && t.status === "pending",
)!;
const cleanVehicle = state.vehicles.find((v) => v.kind === "clean" && v.status === "idle")!;
state = dispatchService(state, "MU2451", cleanTask.id, cleanVehicle.id);
const inTravel = state.services.find((t) => t.id === cleanTask.id)!;
ok("清洁车已在途", inTravel.status === "travel");
ok("在途现场通过存档校验", validShift(state));
// 构造一个删除 clean 的 v4 来触发阻断（同时清理指向 clean 的悬空前置，保证草稿可发布）
const draft4 = draftFromVersion(v3);
draft4.steps = draft4.steps
  .filter((s) => s.id !== "clean")
  .map((s) => ({ ...s, prereqs: s.prereqs.filter((p) => p.stepId !== "clean") }));
state = publishWorkflow(state, "narrow", draft4);
const v4 = latestVersion(
  state.workflows.templates.find((t) => t.id === "narrow")!,
);
const blockPlan = planMigration(
  state.flights.find((f) => f.id === "MU2451")!,
  state.services.filter((t) => t.flightId === "MU2451"),
  v3,
  v4,
);
ok("在途车辆所在步骤被删除时阻断迁移", !blockPlan.canMigrate);
ok("阻断原因指出具体车辆", blockPlan.conflicts.some((c) => c.blocking && c.text.includes(cleanVehicle.id)));
const flowBefore = state.flights.find((f) => f.id === "MU2451")!.flowVersion;
state = migrateFlight(state, "MU2451", v4.version);
ok("无法迁移时现场保持不变", state.flights.find((f) => f.id === "MU2451")!.flowVersion === flowBefore);
ok("阻断后存档仍通过校验", validShift(state));

// 10. 离港检查按实际采用的流程（v3：无 fuel，legacy 不参与）
// 先让第 9 节在途的清洁车正常完成作业
for (let i = 0; i < 200; i++) {
  state = advanceServices(advanceFleet(advanceClock(state, 1), 1), 1);
  if (state.services.find((t) => t.flightId === "MU2451" && t.stepId === "clean")?.status === "done")
    break;
}
ok("清洁车完成作业", state.services.find((t) => t.flightId === "MU2451" && t.stepId === "clean")?.status === "done");
ok("恢复后存档仍通过校验", validShift(state));
// 把某航班当前版本的全部作业跑完（自动等待空闲车辆与前置）
function finishFlight(s: Shift, flightId: string): Shift {
  let cur = s;
  for (let i = 0; i < 1500; i++) {
    const remaining = cur.services.filter(
      (t) => t.flightId === flightId && !t.legacy && t.status !== "done",
    );
    if (remaining.length === 0) return cur;
    for (const task of remaining) {
      if (task.status !== "pending") continue;
      const truck = cur.vehicles.find(
        (v) => v.kind === task.kind && v.status === "idle",
      );
      if (!truck) continue;
      const next = dispatchService(cur, flightId, task.id, truck.id);
      if (next.conflicts === cur.conflicts) cur = next;
    }
    cur = advanceServices(advanceFleet(advanceClock(cur, 1), 1), 1);
  }
  return cur;
}
const readyBefore = state.services
  .filter((t) => t.flightId === "MU2451" && !t.legacy)
  .every((t) => t.status === "done");
ok("存在未完成项时不能离港", !readyBefore);
// 把 v3 剩余作业全部做完
state = finishFlight(state, "MU2451");
const flight = state.flights.find((f) => f.id === "MU2451")!;
const allCurrentDone = state.services
  .filter((t) => t.flightId === "MU2451" && !t.legacy)
  .every((t) => t.status === "done");
ok("当前版本全部作业完成", allCurrentDone);
state = departFlight(state, "MU2451");
ok("按实际流程通过离港检查", state.flights.find((f) => f.id === "MU2451")!.status === "departing");
ok("离港后存档通过校验", validShift(state));

// 11. 前置条件阻止派遣
state = assignStand(state, "CZ3088", "A03");
const cz = state.flights.find((f) => f.id === "CZ3088")!;
ok("宽体停靠钉住 wide v1", cz.flowId === "wide");
const czClean = state.services.find((t) => t.flightId === "CZ3088" && t.stepId === "clean")!;
const czCleanTruck = state.vehicles.find((v) => v.kind === "clean" && v.status === "idle")!;
const blocked = dispatchService(state, "CZ3088", czClean.id, czCleanTruck.id);
ok("前置未完成时派遣被拒绝且计冲突", blocked.conflicts === state.conflicts + 1);

// 12. 完整模拟跑完所有航班，存档始终有效
for (let tick = 0; tick < 1600; tick++) {
  state = advanceClock(state, 1);
  // 自动分配机位：为进港航班寻找尺寸匹配的空闲机位
  for (const f of state.flights.filter((x) => x.status === "incoming")) {
    const stand = state.stands.find(
      (st) =>
        (f.size === "narrow" || st.size === "wide") &&
        !state.flights.some((x) => x.standId === st.id && x.status !== "departed"),
    );
    if (stand) state = assignStand(state, f.id, stand.id);
  }
  // 自动派单：任何可派的 pending 任务找空闲车
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of state.services.filter((t) => t.status === "pending")) {
      const truck = state.vehicles.find((v) => v.kind === task.kind && v.status === "idle");
      if (!truck) continue;
      const next = dispatchService(state, task.flightId, task.id, truck.id);
      if (next !== state && next.conflicts === state.conflicts) {
        state = next;
        changed = true;
      }
    }
  }
  state = advanceServices(advanceFleet(state, 1), 1);
  for (const f of state.flights) {
    if (f.status === "parked") {
      const done = state.services
        .filter((t) => t.flightId === f.id && !t.legacy)
        .every((t) => t.status === "done");
      if (done) state = departFlight(state, f.id);
    }
  }
  assert.ok(validShift(state), `t=${tick} 存档校验失败`);
}
ok("1600 秒自动模拟全程存档有效", true);
const notDeparted = state.flights.filter((f) => f.status !== "departed");
if (notDeparted.length)
  console.log("未离港航班:", notDeparted.map((f) => `${f.id}/${f.status}`));
ok("全部航班离港", state.flights.every((f) => f.status === "departed"));

// 13. 存档往返序列化
const json = JSON.stringify(state);
const restored = JSON.parse(json) as Shift;
ok("序列化后仍通过校验", validShift(restored));
ok("恢复后每项作业保留版本归属", restored.services.every((t) => t.flowId && Number.isInteger(t.flowVersion)));

console.log(`\n全部 ${passed} 项断言通过`);
