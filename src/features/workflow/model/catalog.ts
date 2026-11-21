import type {
  ServiceKind,
  WorkflowMode,
  WorkflowStep,
  WorkflowTemplate,
  WorkflowVersion,
} from "../../../shared/types";

export interface JobTypeInfo {
  label: string;
  english: string;
  /** 单副本基准作业时长（秒） */
  duration: number;
  /** 所需车辆类型（与作业类型一致） */
  vehicleLabel: string;
  icon: string;
  description: string;
  /** 同机坪安全互斥：同一航班上，这些作业类型不得与本作业同时进行 */
  conflictsWith: ServiceKind[];
}

export const jobCatalog: Record<ServiceKind, JobTypeInfo> = {
  baggage: {
    label: "行李装卸",
    english: "BAGGAGE",
    duration: 26,
    vehicleLabel: "行李拖车",
    icon: "▤",
    description: "先卸后装，释放客舱与货舱作业区域",
    conflictsWith: [],
  },
  fuel: {
    label: "燃油补给",
    english: "REFUEL",
    duration: 34,
    vehicleLabel: "加油车",
    icon: "◈",
    description: "独立加油管路作业，可与多数保障并行",
    conflictsWith: ["deice"],
  },
  clean: {
    label: "客舱清洁",
    english: "CABIN CLEAN",
    duration: 22,
    vehicleLabel: "清洁车",
    icon: "✧",
    description: "人员进入客舱，须等待行李卸载让出通道",
    conflictsWith: [],
  },
  catering: {
    label: "餐食补给",
    english: "CATERING",
    duration: 18,
    vehicleLabel: "餐车",
    icon: "❖",
    description: "从侧门装卸餐食，与客舱清洁争抢同一舱门",
    conflictsWith: ["clean"],
  },
  power: {
    label: "地面电源",
    english: "GPU POWER",
    duration: 20,
    vehicleLabel: "电源车",
    icon: "⚡",
    description: "停靠后即可接驳，为整机供电",
    conflictsWith: [],
  },
  water: {
    label: "清水与污水",
    english: "WATER",
    duration: 16,
    vehicleLabel: "清水车",
    icon: "◐",
    description: "清水补给与污水回收，占用机腹服务点",
    conflictsWith: ["baggage"],
  },
  deice: {
    label: "除防冰",
    english: "DE-ICE",
    duration: 28,
    vehicleLabel: "除冰车",
    icon: "❄",
    description: "喷洒除冰液，作业期间禁止加油与明火",
    conflictsWith: ["fuel"],
  },
};

export const serviceKinds = Object.keys(jobCatalog) as ServiceKind[];

/** 宽体机作业时长系数 */
export const wideDurationFactor = 1.3;

export function jobDuration(kind: ServiceKind, size: "narrow" | "wide"): number {
  return Math.round(
    jobCatalog[kind].duration * (size === "wide" ? wideDurationFactor : 1),
  );
}

function step(
  id: string,
  kind: ServiceKind,
  copies: number,
  prereqs: WorkflowStep["prereqs"] = [],
): WorkflowStep {
  return { id, kind, copies, prereqs };
}

/**
 * 默认流程复刻改版前的固定规则：
 * 行李装卸 → 客舱清洁；燃油无前置、可并行；现场最多 2 个服务位。
 */
function defaultVersion(size: "narrow" | "wide"): WorkflowVersion {
  const baggageCopies = size === "wide" ? 2 : 1;
  return {
    version: 1,
    createdAt: 0,
    mode: "parallel",
    maxConcurrent: 2,
    note: "系统默认流程：行李 → 清洁，燃油并行",
    steps: [
      step("baggage", "baggage", baggageCopies),
      step("fuel", "fuel", 1),
      step("clean", "clean", 1, [{ stepId: "baggage", mode: "all" }]),
    ],
  };
}

export function defaultTemplates(): WorkflowTemplate[] {
  return [
    {
      id: "narrow",
      label: "窄体机流程（A320 / B737）",
      versions: [defaultVersion("narrow")],
    },
    {
      id: "wide",
      label: "宽体机流程（B787 / A350）",
      versions: [defaultVersion("wide")],
    },
  ];
}

export function latestVersion(template: WorkflowTemplate): WorkflowVersion {
  return template.versions[template.versions.length - 1];
}

export function findTemplate(
  store: { templates: WorkflowTemplate[] },
  id: string,
): WorkflowTemplate | undefined {
  return store.templates.find((t) => t.id === id);
}

export function findVersion(
  store: { templates: WorkflowTemplate[] },
  id: string,
  version: number,
): WorkflowVersion | undefined {
  return findTemplate(store, id)?.versions.find((v) => v.version === version);
}

export function modeLabel(mode: WorkflowMode): string {
  return mode === "parallel" ? "尽量并行" : "全部串行";
}
