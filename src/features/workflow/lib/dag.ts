import type { WorkflowStep, WorkflowVersion } from "../../../shared/types";

export interface WorkflowIssue {
  level: "error" | "warning";
  text: string;
  stepId?: string;
}

/** Kahn 拓扑排序：返回 null 表示存在环形依赖 */
export function topoOrder(steps: WorkflowStep[]): WorkflowStep[] | null {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const indegree = new Map(steps.map((s) => [s.id, 0]));
  const adjacency = new Map(steps.map((s) => [s.id, [] as string[]]));
  for (const s of steps) {
    for (const p of s.prereqs) {
      if (!byId.has(p.stepId)) continue;
      adjacency.get(p.stepId)!.push(s.id);
      indegree.set(s.id, (indegree.get(s.id) ?? 0) + 1);
    }
  }
  const queue = steps.filter((s) => (indegree.get(s.id) ?? 0) === 0).map((s) => s.id);
  const order: WorkflowStep[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of adjacency.get(id) ?? []) {
      const d = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, d);
      if (d === 0) queue.push(next);
    }
  }
  return order.length === steps.length ? order : null;
}

/** 找出环上的步骤 ID（基于 DFS 着色），用于编辑器高亮 */
export function cycleMembers(steps: WorkflowStep[]): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const color = new Map<string, 0 | 1 | 2>();
  const members = new Set<string>();
  const visit = (id: string, stack: string[]): boolean => {
    color.set(id, 1);
    for (const p of byId.get(id)?.prereqs ?? []) {
      if (!byId.has(p.stepId)) continue;
      const c = color.get(p.stepId) ?? 0;
      if (c === 1) {
        for (let i = stack.indexOf(p.stepId); i < stack.length; i++)
          members.add(stack[i]);
        members.add(p.stepId);
        return true;
      }
      if (c === 0 && visit(p.stepId, [...stack, p.stepId])) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const s of steps) if ((color.get(s.id) ?? 0) === 0) visit(s.id, [s.id]);
  return members;
}

export function validateWorkflow(version: WorkflowVersion): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const steps = version.steps;
  if (steps.length === 0) {
    issues.push({ level: "error", text: "流程至少需要一个作业步骤" });
    return issues;
  }
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.id.trim())
      issues.push({ level: "error", text: "存在没有标识的步骤", stepId: s.id });
    if (ids.has(s.id))
      issues.push({ level: "error", text: `步骤标识「${s.id}」重复`, stepId: s.id });
    ids.add(s.id);
    if (!Number.isInteger(s.copies) || s.copies < 1)
      issues.push({
        level: "error",
        text: `「${s.id}」的重复数量必须是不小于 1 的整数`,
        stepId: s.id,
      });
    if (s.copies > 4)
      issues.push({
        level: "warning",
        text: `「${s.id}」配置了 ${s.copies} 个副本，现场车队可能不足以同时派遣`,
        stepId: s.id,
      });
  }
  for (const s of steps) {
    for (const p of s.prereqs) {
      if (!ids.has(p.stepId))
        issues.push({
          level: "error",
          text: `「${s.id}」引用了不存在的前置步骤「${p.stepId}」`,
          stepId: s.id,
        });
      if (p.stepId === s.id)
        issues.push({
          level: "error",
          text: `「${s.id}」不能把自己设为前置（自环）`,
          stepId: s.id,
        });
    }
  }
  const order = topoOrder(steps);
  if (!order) {
    const ring = [...cycleMembers(steps)].join(" → ");
    issues.push({
      level: "error",
      text: `检测到环形依赖：${ring}，请删除一条反向前置`,
    });
  }
  if (version.maxConcurrent < 1)
    issues.push({ level: "error", text: "现场服务位上限至少为 1" });
  if (version.maxConcurrent > 4)
    issues.push({
      level: "warning",
      text: "服务位超过 4 个时，机坪安全间距无法保证",
    });
  return issues;
}

export function hasBlockingErrors(issues: WorkflowIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
