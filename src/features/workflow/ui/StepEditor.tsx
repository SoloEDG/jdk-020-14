import type { ServiceKind } from "../../../shared/types";
import { jobCatalog } from "../model/catalog";
import type { WorkflowDraft } from "../model/editor";
import {
  addStep,
  availableKinds,
  removeStep,
  setCopies,
  togglePrereq,
} from "../model/editor";

interface Props {
  draft: WorkflowDraft;
  cycle: Set<string>;
  onChange: (draft: WorkflowDraft) => void;
}

function PrereqMatrix({ draft, cycle, onChange }: Props) {
  const cols = Math.max(1, draft.steps.length - 1);
  return (
    <div className="prereq-matrix">
      <div
        className="matrix-row matrix-head"
        style={{ gridTemplateColumns: `1.4fr repeat(${cols}, 1fr)` }}
      >
        <span>作业步骤</span>
        {Array.from({ length: cols }).map((_, i) => (
          <span key={i}>
            前置 {i + 1}
            <br />
            全副本 / 任一副本
          </span>
        ))}
      </div>
      {draft.steps.map((step) => (
        <div
          className={`matrix-row ${cycle.has(step.id) ? "ring" : ""}`}
          key={step.id}
          style={{ gridTemplateColumns: `1.4fr repeat(${cols}, 1fr)` }}
        >
          <span title={step.id}>
            <i className="kind-dot" style={{ color: `var(--k-${step.kind})` }}>
              {jobCatalog[step.kind].icon}
            </i>
            {jobCatalog[step.kind].label}
            <small>{step.id}</small>
          </span>
          {draft.steps
            .filter((candidate) => candidate.id !== step.id)
            .map((candidate) => {
              const link = step.prereqs.find((p) => p.stepId === candidate.id);
              return (
                <span className="cell" key={candidate.id}>
                  {(["all", "any"] as const).map((mode) => (
                    <button
                      key={mode}
                      title={`${jobCatalog[step.kind].label} 等待 ${jobCatalog[candidate.kind].label} ${mode === "all" ? "全部副本" : "任一副本"}`}
                      className={link?.mode === mode ? "on" : ""}
                      onClick={() =>
                        onChange(togglePrereq(draft, step.id, candidate.id, mode))
                      }
                    >
                      {mode === "all" ? "全" : "一"}
                    </button>
                  ))}
                </span>
              );
            })}
        </div>
      ))}
    </div>
  );
}

export function StepEditor({ draft, cycle, onChange }: Props) {
  const kinds = availableKinds(draft);
  return (
    <div className="step-editor">
      <div className="editor-toolbar">
        <label>
          现场服务位（安全上限）
          <input
            type="number"
            min={1}
            max={4}
            value={draft.maxConcurrent}
            onChange={(e) =>
              onChange({
                ...draft,
                maxConcurrent: Math.max(1, Math.min(4, Number(e.target.value) || 1)),
              })
            }
          />
        </label>
        <div className="mode-switch">
          <button
            className={draft.mode === "parallel" ? "on" : ""}
            onClick={() => onChange({ ...draft, mode: "parallel" })}
          >
            尽量并行
          </button>
          <button
            className={draft.mode === "serial" ? "on" : ""}
            onClick={() => onChange({ ...draft, mode: "serial" })}
          >
            全部串行
          </button>
        </div>
      </div>

      <div className="step-cards">
        {draft.steps.map((step) => {
          const info = jobCatalog[step.kind];
          return (
            <div
              className={`step-card ${cycle.has(step.id) ? "ring" : ""}`}
              key={step.id}
            >
              <div className="step-card-head">
                <span className="step-icon">{info.icon}</span>
                <div>
                  <strong>{info.label}</strong>
                  <small>
                    {step.id} · 需要 {info.vehicleLabel}
                  </small>
                </div>
                <button
                  className="step-remove"
                  title="删除步骤（同时清理引用它的前置）"
                  onClick={() => onChange(removeStep(draft, step.id))}
                >
                  ✕
                </button>
              </div>
              <p className="step-desc">{info.description}</p>
              <div className="step-row">
                <span>重复作业数量</span>
                <div className="copies-stepper">
                  <button
                    onClick={() => onChange(setCopies(draft, step.id, step.copies - 1))}
                  >
                    −
                  </button>
                  <b>{step.copies}</b>
                  <button
                    onClick={() => onChange(setCopies(draft, step.id, step.copies + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="step-row prereq-row">
                <span>前置步骤</span>
                <div className="prereq-chips">
                  {step.prereqs.length === 0 && <em>无，停靠后即可派遣</em>}
                  {step.prereqs.map((p) => {
                    const target = draft.steps.find((x) => x.id === p.stepId);
                    if (!target) return null;
                    return (
                      <button
                        key={p.stepId}
                        title="点击移除该前置"
                        onClick={() =>
                          onChange(togglePrereq(draft, step.id, p.stepId, p.mode))
                        }
                      >
                        {jobCatalog[target.kind].label}
                        <b>{p.mode === "all" ? "全部" : "任一"}</b>
                      </button>
                    );
                  })}
                </div>
              </div>
              {info.conflictsWith.length > 0 && (
                <p className="safety-note">
                  ⚠ 安全互斥：不可与
                  {info.conflictsWith
                    .map((k: ServiceKind) => jobCatalog[k].label)
                    .join("、")}
                  同时作业
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="add-step">
        <span>新增作业：</span>
        {kinds.length === 0 && <em>全部作业类型均已加入流程</em>}
        {kinds.map((kind) => (
          <button
            key={kind}
            className="add-step-btn"
            title={jobCatalog[kind].description}
            onClick={() => onChange(addStep(draft, kind))}
          >
            {jobCatalog[kind].icon} {jobCatalog[kind].label}
          </button>
        ))}
      </div>

      <PrereqMatrix draft={draft} cycle={cycle} onChange={onChange} />
    </div>
  );
}
