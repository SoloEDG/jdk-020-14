import type { MigrationPlan } from "../lib/migration";
import { jobCatalog } from "../model/catalog";

const copyLabels: Record<string, string> = {
  "reuse-done": "成果继承",
  "reuse-active": "随车保留",
  "reuse-pending": "待派遣 · 适用新前置",
  new: "新增副本",
  removed: "新版移除",
};

export function MigrationDialog({
  plan,
  onConfirm,
  onCancel,
}: {
  plan: MigrationPlan;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal wide" onMouseDown={(e) => e.stopPropagation()}>
        <span className="eyebrow">FLOW MIGRATION</span>
        <h2>
          流程迁移 · v{plan.fromVersion} → v{plan.toVersion}
        </h2>
        <p>
          仅按步骤标识（stepId）对齐，名称相同但标识不同的作业不会继承任何成果。
        </p>
        <div className="migration-summary">
          <span className="ok">已完成成果保留 {plan.doneKept}</span>
          <span className="ok">在途车辆保留 {plan.activeKept}</span>
          <span>新增作业 {plan.created}</span>
          <span>取消未派遣 {plan.dropped}</span>
          <span>遗留备查 {plan.legacy}</span>
        </div>
        <div className="migration-table">
          {plan.steps.map((step) => (
            <div
              className={`migration-step ${step.brandNew ? "brand-new" : ""} ${step.removed ? "removed" : ""}`}
              key={step.stepId}
            >
              <div className="migration-step-head">
                <strong>{jobCatalog[step.kind].label}</strong>
                <small>
                  {step.stepId} · 副本 {step.oldCopies} → {step.newCopies}
                </small>
                {step.brandNew && <b className="tag">全新步骤</b>}
                {step.removed && <b className="tag warn">新版已删除</b>}
              </div>
              <div className="migration-copies">
                {step.copies.map((c) => (
                  <span
                    key={c.copyIndex}
                    className={`copy-kind ${c.kind} ${c.addedPrereq ? "prereq" : ""}`}
                  >
                    #{c.copyIndex + 1} {copyLabels[c.kind]}
                    {c.vehicleId && <em>{c.vehicleId}</em>}
                    {c.addedPrereq && <em>含新增前置</em>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        {plan.conflicts.length > 0 && (
          <div className="migration-conflicts">
            {plan.conflicts.map((c, i) => (
              <p key={i} className={c.blocking ? "block" : ""}>
                {c.blocking ? "⛔ " : "↳ "}
                {c.text}
              </p>
            ))}
          </div>
        )}
        <div>
          <button className="secondary" onClick={onCancel}>
            保留现有现场（不迁移）
          </button>
          <button
            className="primary"
            disabled={!plan.canMigrate}
            title={plan.canMigrate ? "" : "存在阻断冲突，只能保留当前流程"}
            onClick={onConfirm}
          >
            {plan.canMigrate ? "确认迁移" : "无法迁移 · 保留现场"}
          </button>
        </div>
      </div>
    </div>
  );
}
