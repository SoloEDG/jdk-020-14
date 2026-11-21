import type {
  ServiceKind,
  WorkflowMode,
  WorkflowStep,
  WorkflowVersion,
} from "../../../shared/types";
import { serviceKinds } from "./catalog";

/** 编辑器内的可编辑草稿；发布成功后才会成为不可变版本 */
export type WorkflowDraft = Omit<WorkflowVersion, "version" | "createdAt">;

export function draftFromVersion(version: WorkflowVersion): WorkflowDraft {
  return {
    mode: version.mode,
    maxConcurrent: version.maxConcurrent,
    note: version.note,
    steps: version.steps.map((s) => ({
      id: s.id,
      kind: s.kind,
      copies: s.copies,
      prereqs: s.prereqs.map((p) => ({ ...p })),
    })),
  };
}

function uniqueStepId(kind: ServiceKind, steps: WorkflowStep[]): string {
  const ids = new Set(steps.map((s) => s.id));
  if (!ids.has(kind)) return kind;
  let n = 2;
  while (ids.has(`${kind}-${n}`)) n++;
  return `${kind}-${n}`;
}

export function addStep(draft: WorkflowDraft, kind: ServiceKind): WorkflowDraft {
  if (draft.steps.some((s) => s.kind === kind)) return draft;
  const step: WorkflowStep = {
    id: uniqueStepId(kind, draft.steps),
    kind,
    copies: 1,
    prereqs: [],
  };
  return { ...draft, steps: [...draft.steps, step] };
}

export function removeStep(draft: WorkflowDraft, stepId: string): WorkflowDraft {
  return {
    ...draft,
    steps: draft.steps
      .filter((s) => s.id !== stepId)
      .map((s) => ({
        ...s,
        prereqs: s.prereqs.filter((p) => p.stepId !== stepId),
      })),
  };
}

export function setCopies(
  draft: WorkflowDraft,
  stepId: string,
  copies: number,
): WorkflowDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) =>
      s.id === stepId ? { ...s, copies: Math.max(1, Math.min(4, copies)) } : s,
    ),
  };
}

export function setMode(draft: WorkflowDraft, mode: WorkflowMode): WorkflowDraft {
  return { ...draft, mode };
}

export function setMaxConcurrent(
  draft: WorkflowDraft,
  maxConcurrent: number,
): WorkflowDraft {
  return { ...draft, maxConcurrent: Math.max(1, Math.min(4, maxConcurrent)) };
}

/** 切换前置：同一前置在 all/any 之间切换，再点一次移除 */
export function togglePrereq(
  draft: WorkflowDraft,
  stepId: string,
  prereqId: string,
  mode: "all" | "any",
): WorkflowDraft {
  return {
    ...draft,
    steps: draft.steps.map((s) => {
      if (s.id !== stepId) return s;
      const existing = s.prereqs.find((p) => p.stepId === prereqId);
      if (!existing)
        return { ...s, prereqs: [...s.prereqs, { stepId: prereqId, mode }] };
      if (existing.mode === mode)
        return { ...s, prereqs: s.prereqs.filter((p) => p.stepId !== prereqId) };
      return {
        ...s,
        prereqs: s.prereqs.map((p) =>
          p.stepId === prereqId ? { ...p, mode } : p,
        ),
      };
    }),
  };
}

export function availableKinds(draft: WorkflowDraft): ServiceKind[] {
  const used = new Set(draft.steps.map((s) => s.kind));
  return serviceKinds.filter((k) => !used.has(k));
}
