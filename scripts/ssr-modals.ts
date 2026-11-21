import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";
import { createShift } from "../src/features/session/model/shift";
import { assignStand } from "../src/features/flights/model/commands";
import {
  draftFromVersion,
  latestVersion,
  planMigration,
  publishWorkflow,
} from "../src/features/workflow";

const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const { WorkflowModal } = await server.ssrLoadModule("/src/features/workflow/ui/WorkflowModal");
const { MigrationDialog } = await server.ssrLoadModule("/src/features/workflow/ui/MigrationDialog");

let state = assignStand(createShift(), "MU2451", "A01");
// 先完成一项作业，迁移对话框才能展示"成果继承"
{
  const task = state.services.find((t) => t.stepId === "baggage")!;
  task.status = "done";
  task.progress = 100;
}
const narrow = state.workflows.templates.find((t) => t.id === "narrow")!;
const draft = draftFromVersion(latestVersion(narrow));
draft.steps.push({ id: "catering", kind: "catering", copies: 2, prereqs: [{ stepId: "clean", mode: "all" }] });
state = publishWorkflow(state, "narrow", draft);

const editorHtml = renderToString(
  React.createElement(WorkflowModal, {
    state,
    onClose: () => {},
    onPublish: () => {},
  }),
);
for (const token of ["保障流程编辑器", "方案比较", "新增作业", "现场服务位", "重复作业数量"])
  console.log(`editor contains ${token}:`, editorHtml.includes(token));

const flight = state.flights.find((f) => f.id === "MU2451")!;
const after = state.workflows.templates.find((t) => t.id === "narrow")!;
const plan = planMigration(
  flight,
  state.services.filter((t) => t.flightId === "MU2451"),
  after.versions[0],
  after.versions[1],
);
const dialogHtml = renderToString(
  React.createElement(MigrationDialog, {
    plan,
    onConfirm: () => {},
    onCancel: () => {},
  }),
);
for (const token of ["流程迁移", "成果继承", "新增副本", "确认迁移"])
  console.log(`migration contains ${token}:`, dialogHtml.includes(token));

await server.close();
console.log("弹窗组件 SSR 渲染检查完成");
