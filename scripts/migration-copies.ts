import assert from "node:assert/strict";
import { createShift } from "../src/features/session/model/shift";
import { assignStand } from "../src/features/flights/model/commands";
import { dispatchService } from "../src/features/services/model/dispatch";
import { advanceFleet } from "../src/features/fleet/model/movement";
import { advanceServices } from "../src/features/services/model/progress";
import { advanceClock } from "../src/features/session/model/clock";
import {
  draftFromVersion,
  latestVersion,
  publishWorkflow,
  migrateFlight,
  planMigration,
} from "../src/features/workflow";
import { validShift } from "../src/features/session/lib/validation";
import type { Shift } from "../src/shared/types";

let n = 0;
const check = (name: string, cond: boolean) => {
  assert.ok(cond, name);
  n++;
  console.log("✓", name);
};

function finishOne(s: Shift, flightId: string, stepId: string, copyIndex: number): Shift {
  let cur = s;
  const task = cur.services.find(
    (t) => t.flightId === flightId && t.stepId === stepId && t.copyIndex === copyIndex,
  )!;
  const truck = cur.vehicles.find((v) => v.kind === task.kind && v.status === "idle")!;
  cur = dispatchService(cur, flightId, task.id, truck.id);
  for (let i = 0; i < 200; i++) {
    cur = advanceServices(advanceFleet(advanceClock(cur, 1), 1), 1);
    if (cur.services.find((x) => x.id === task.id)?.status === "done") break;
  }
  return cur;
}

let state: Shift = createShift();
// 宽体机默认行李 2 副本
state = assignStand(state, "CZ3088", "A03");
const wideId = "wide";
let wide = state.workflows.templates.find((t) => t.id === wideId)!;
check("宽体初始行李 2 副本",
  latestVersion(wide).steps.find((s) => s.id === "baggage")!.copies === 2);
const baggageTasks = state.services.filter((t) => t.flightId === "CZ3088" && t.stepId === "baggage");
check("实例化 2 个行李任务", baggageTasks.length === 2);

// 第一份行李真实完成（有车辆、有进度），第二份仍待派遣，然后把副本数缩减为 1
state = finishOne(state, "CZ3088", "baggage", 0);
const draft = draftFromVersion(latestVersion(wide));
draft.steps.find((s) => s.id === "baggage")!.copies = 1;
state = publishWorkflow(state, wideId, draft);
wide = state.workflows.templates.find((t) => t.id === wideId)!;
const v2 = latestVersion(wide);
const plan = planMigration(
  state.flights.find((f) => f.id === "CZ3088")!,
  state.services.filter((t) => t.flightId === "CZ3088"),
  wide.versions[0],
  v2,
);
check("缩减副本可迁移", plan.canMigrate);
const baggagePlan = plan.steps.find((s) => s.stepId === "baggage")!;
check("副本 0 继承成果、副本 1 被移除",
  baggagePlan.copies[0].kind === "reuse-done" && baggagePlan.copies[1].kind === "removed");

state = migrateFlight(state, "CZ3088", v2.version);
const after = state.services.filter((t) => t.flightId === "CZ3088" && t.stepId === "baggage");
check("迁移后只剩 1 个行李任务", after.length === 1 && after[0].status === "done");
check("迁移后存档有效", validShift(state));

// 反向：副本从 1 扩到 3，新增的应是待派遣
const draft3 = draftFromVersion(v2);
draft3.steps.find((s) => s.id === "baggage")!.copies = 3;
state = publishWorkflow(state, wideId, draft3);
wide = state.workflows.templates.find((t) => t.id === wideId)!;
const v3 = latestVersion(wide);
state = migrateFlight(state, "CZ3088", v3.version);
const grown = state.services.filter((t) => t.flightId === "CZ3088" && t.stepId === "baggage");
check("扩容后有 3 个行李任务", grown.length === 3);
check("新增副本为待派遣且序号正确",
  grown.filter((t) => t.status === "pending").length === 2 &&
    grown.map((t) => t.copyIndex).sort((a, b) => a - b).join(",") === "0,1,2");
check("扩容后存档有效", validShift(state));

console.log(`\n副本伸缩迁移 ${n} 项断言通过`);
