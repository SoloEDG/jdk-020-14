export type ServiceKind =
  | "baggage"
  | "fuel"
  | "clean"
  | "catering"
  | "power"
  | "water"
  | "deice";
export type FlightStatus =
  | "scheduled"
  | "incoming"
  | "parked"
  | "departing"
  | "departed";
export interface Point {
  x: number;
  y: number;
}
export interface Flight {
  id: string;
  airline: string;
  from: string;
  destination: string;
  aircraft: string;
  size: "narrow" | "wide";
  arrival: number;
  deadline: number;
  passengers: number;
  status: FlightStatus;
  standId?: string;
  departureAt?: number;
  color: string;
  /** 开工（停靠）时钉住的流程模板 id，未开工航班为空 */
  flowId?: string;
  /** 钉住的流程版本号 */
  flowVersion?: number;
}
export interface Stand extends Point {
  id: string;
  size: "narrow" | "wide";
  terminal: string;
}
/** 前置关系：mode=all 要求该步骤全部副本完成，any 要求至少一个副本完成 */
export interface Prerequisite {
  stepId: string;
  mode: "all" | "any";
}
export interface WorkflowStep {
  /** 模板内稳定标识，跨版本保持不变，是成果继承的唯一依据 */
  id: string;
  kind: ServiceKind;
  /** 重复作业数量（如宽体机需要两辆行李车） */
  copies: number;
  prereqs: Prerequisite[];
}
export type WorkflowMode = "parallel" | "serial";
export interface WorkflowVersion {
  version: number;
  createdAt: number;
  mode: WorkflowMode;
  /** 机位现场服务位上限（同时作业安全限制） */
  maxConcurrent: number;
  steps: WorkflowStep[];
  note?: string;
}
export interface WorkflowTemplate {
  /** 与机型 size 对应 */
  id: string;
  label: string;
  /** 按版本号升序，最后一项为最新版；已发布版本不可变 */
  versions: WorkflowVersion[];
}
export interface WorkflowStore {
  templates: WorkflowTemplate[];
}
export interface Service {
  id: string;
  flightId: string;
  /** 所属步骤的稳定 ID —— 迁移与版本归属只认 stepId，不认作业名称 */
  stepId: string;
  /** 同一重复步骤中的副本序号（0 起） */
  copyIndex: number;
  kind: ServiceKind;
  flowId: string;
  flowVersion: number;
  status: "pending" | "travel" | "working" | "done";
  progress: number;
  duration: number;
  vehicleId?: string;
  /** 迁移后被新流程移除、但成果保留备查的遗留作业，不参与离港检查 */
  legacy?: boolean;
}
export interface Vehicle {
  id: string;
  kind: ServiceKind;
  status: "idle" | "travel" | "working" | "returning";
  position: Point;
  origin: Point;
  target: Point;
  progress: number;
  tripDuration: number;
  serviceId?: string;
}
export interface Event {
  id: number;
  time: number;
  text: string;
  tone: "info" | "success" | "warning";
}
export interface Shift {
  version: 2;
  time: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  score: number;
  conflicts: number;
  flights: Flight[];
  stands: Stand[];
  services: Service[];
  vehicles: Vehicle[];
  events: Event[];
  workflows: WorkflowStore;
  selectedFlightId: string;
  selectedStandId?: string;
  selectedVehicleId?: string;
  nextEventId: number;
}
export type CommandResult = (state: Shift) => Shift;
