import { useMemo, useState } from "react";
import type { Shift, WorkflowTemplate } from "../../../shared/types";
import {
  hasBlockingErrors,
  latestVersion,
  modeLabel,
  validateWorkflow,
} from "..";
import { draftFromVersion } from "../model/editor";
import { cycleMembers } from "../lib/dag";
import { StepEditor } from "./StepEditor";
import { EstimatePanel } from "./EstimatePanel";

export function WorkflowModal({
  state,
  onClose,
  onPublish,
}: {
  state: Shift;
  onClose: () => void;
  onPublish: (templateId: string, draft: ReturnType<typeof draftFromVersion>) => void;
}) {
  const [templateId, setTemplateId] = useState(state.workflows.templates[0].id);
  const template = state.workflows.templates.find((t) => t.id === templateId)!;
  const latest = latestVersion(template);
  const [draft, setDraft] = useState(() => draftFromVersion(latest));

  const select = (next: WorkflowTemplate) => {
    setTemplateId(next.id);
    setDraft(draftFromVersion(latestVersion(next)));
  };

  const candidate = useMemo(
    () => ({ ...draft, version: latest.version + 1, createdAt: state.time }),
    [draft, latest.version, state.time],
  );
  const issues = useMemo(() => validateWorkflow(candidate), [candidate]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  const cycle = useMemo(() => cycleMembers(candidate.steps), [candidate]);
  const blocked = hasBlockingErrors(issues);
  const unchanged =
    JSON.stringify(draft.steps) === JSON.stringify(latest.steps) &&
    draft.mode === latest.mode &&
    draft.maxConcurrent === latest.maxConcurrent;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal wide editor-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="editor-head">
          <div>
            <span className="eyebrow">TURNAROUND FLOW EDITOR</span>
            <h2>保障流程编辑器</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="template-tabs">
          {state.workflows.templates.map((t) => (
            <button
              key={t.id}
              className={templateId === t.id ? "on" : ""}
              onClick={() => select(t)}
            >
              {t.label}
              <small>最新 v{latestVersion(t).version}</small>
            </button>
          ))}
        </div>

        <div className="version-strip">
          <span>已发布版本（不可变）：</span>
          {template.versions.map((v) => (
            <button
              key={v.version}
              className={v.version === latest.version ? "on" : ""}
              title={v.note}
              onClick={() => setDraft(draftFromVersion(v))}
            >
              v{v.version} · {modeLabel(v.mode)} · {v.maxConcurrent} 位
            </button>
          ))}
          <button
            className="reset-draft"
            onClick={() => setDraft(draftFromVersion(latest))}
          >
            草稿重置为最新版
          </button>
        </div>

        <div className="editor-body">
          <StepEditor draft={draft} cycle={cycle} onChange={setDraft} />
          <EstimatePanel draft={draft} size={template.id as "narrow" | "wide"} />
        </div>

        <div className="issue-list">
          {errors.map((issue, i) => (
            <p key={`e${i}`} className="block">
              ⛔ {issue.text}
            </p>
          ))}
          {warnings.map((issue, i) => (
            <p key={`w${i}`} className="warn">↳ {issue.text}</p>
          ))}
          {issues.length === 0 && (
            <p className="ok">✓ 依赖图无环，前置关系与安全限制校验通过</p>
          )}
        </div>

        <div className="editor-actions">
          <p className="publish-note">
            发布后生成 v{latest.version + 1}：尚未开工的航班默认使用新版；
            已停靠航班继续使用钉住的旧版，需在航班面板中显式迁移。
          </p>
          <button className="secondary" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={blocked || unchanged}
            title={blocked ? "存在阻断错误，无法发布" : unchanged ? "草稿与最新版一致" : ""}
            onClick={() => onPublish(template.id, draft)}
          >
            发布 v{latest.version + 1}
          </button>
        </div>
      </div>
    </div>
  );
}