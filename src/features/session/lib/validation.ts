import type { ServiceKind, Shift, WorkflowVersion } from "../../../shared/types";
import { jobCatalog, serviceKinds } from "../../workflow/model/catalog";
import { topoOrder } from "../../workflow/lib/dag";

const flightStates = [
  "scheduled",
  "incoming",
  "parked",
  "departing",
  "departed",
];
const serviceStates = ["pending", "travel", "working", "done"];
const vehicleStates = ["idle", "travel", "working", "returning"];
type Row = Record<string, unknown>;
function row(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function point(value: unknown): boolean {
  return row(value) && finite(value.x) && finite(value.y);
}
function unique(values: Row[]): boolean {
  return (
    values.every((x) => text(x.id)) &&
    new Set(values.map((x) => x.id)).size === values.length
  );
}
function collection(value: unknown): value is Row[] {
  return Array.isArray(value) && value.every(row) && unique(value);
}

function validWorkflow(version: unknown): version is WorkflowVersion {
  if (!row(version)) return false;
  if (!finite(version.version) || version.version < 1) return false;
  if (!["parallel", "serial"].includes(version.mode as string)) return false;
  if (!finite(version.maxConcurrent) || version.maxConcurrent < 1) return false;
  if (!Array.isArray(version.steps) || version.steps.length === 0) return false;
  const steps = version.steps as Row[];
  const ids = new Set<string>();
  for (const step of steps) {
    if (!row(step) || !text(step.id) || ids.has(step.id)) return false;
    ids.add(step.id);
    if (!serviceKinds.includes(step.kind as ServiceKind)) return false;
    if (!Number.isInteger(step.copies) || (step.copies as number) < 1 || (step.copies as number) > 4)
      return false;
    if (!Array.isArray(step.prereqs)) return false;
    for (const p of step.prereqs as Row[]) {
      if (
        !row(p) ||
        !text(p.stepId) ||
        !["all", "any"].includes(p.mode as string)
      )
        return false;
    }
  }
  for (const step of steps) {
    if ((step.prereqs as Row[]).some((p) => !ids.has(p.stepId as string)))
      return false;
  }
  return topoOrder(steps as unknown as WorkflowVersion["steps"]) !== null;
}

export function validShift(value: unknown): value is Shift {
  if (
    !row(value) ||
    value.version !== 2 ||
    !finite(value.time) ||
    value.time < 0 ||
    !finite(value.score) ||
    !finite(value.conflicts) ||
    value.conflicts < 0 ||
    typeof value.paused !== "boolean" ||
    ![1, 2, 4].includes(value.speed as number) ||
    !finite(value.nextEventId)
  )
    return false;
  if (
    !collection(value.flights) ||
    value.flights.length !== 6 ||
    !collection(value.stands) ||
    value.stands.length !== 6 ||
    !collection(value.vehicles) ||
    value.vehicles.length === 0 ||
    !collection(value.services) ||
    !Array.isArray(value.events) ||
    value.events.length > 30 ||
    !row(value.workflows) ||
    !Array.isArray(value.workflows.templates)
  )
    return false;

  const workflows = value.workflows as {
    templates: (Row & { id: string; versions: WorkflowVersion[] })[];
  };
  const templateIds = new Set<string>();
  for (const template of workflows.templates) {
    if (!text(template.id) || templateIds.has(template.id)) return false;
    templateIds.add(template.id);
    if (!Array.isArray(template.versions) || template.versions.length === 0)
      return false;
    const versions = template.versions as unknown[];
    let lastVersion = 0;
    for (const v of versions) {
      if (!validWorkflow(v)) return false;
      if (v.version <= lastVersion) return false;
      lastVersion = v.version;
    }
  }

  const flights = value.flights,
    stands = value.stands,
    vehicles = value.vehicles,
    services = value.services;
  const flightIds = new Set(flights.map((x) => x.id)),
    standIds = new Set(stands.map((x) => x.id)),
    vehicleIds = new Set(vehicles.map((x) => x.id)),
    serviceIds = new Set(services.map((x) => x.id));
  if (
    !flights.every(
      (f) =>
        text(f.airline) &&
        text(f.from) &&
        text(f.destination) &&
        text(f.aircraft) &&
        ["narrow", "wide"].includes(f.size as string) &&
        flightStates.includes(f.status as string) &&
        finite(f.arrival) &&
        finite(f.deadline) &&
        finite(f.passengers) &&
        f.passengers > 0 &&
        text(f.color) &&
        (f.departureAt === undefined || finite(f.departureAt)) &&
        (f.standId === undefined || standIds.has(f.standId)) &&
        (f.flowId === undefined || templateIds.has(f.flowId as string)) &&
        (f.flowVersion === undefined || finite(f.flowVersion)),
    )
  )
    return false;
  const started = flights.filter(
    (f) => f.status === "parked" || f.status === "departing" || f.status === "departed",
  );
  if (
    started.some(
      (f) =>
        !text(f.flowId) ||
        !finite(f.flowVersion) ||
        !workflows.templates
          .find((t) => t.id === f.flowId)
          ?.versions.some((v: WorkflowVersion) => v.version === f.flowVersion),
    )
  )
    return false;
  if (
    flights.some(
      (f) =>
        (f.status === "scheduled" || f.status === "incoming") &&
        f.flowId !== undefined,
    )
  )
    return false;

  if (
    !stands.every(
      (s) =>
        point(s) &&
        ["narrow", "wide"].includes(s.size as string) &&
        text(s.terminal),
    )
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        serviceKinds.includes(v.kind as ServiceKind) &&
        vehicleStates.includes(v.status as string) &&
        point(v.position) &&
        point(v.origin) &&
        point(v.target) &&
        finite(v.progress) &&
        v.progress >= 0 &&
        v.progress <= 100 &&
        finite(v.tripDuration) &&
        v.tripDuration > 0 &&
        (v.serviceId === undefined || serviceIds.has(v.serviceId)),
    )
  )
    return false;

  const versionOf = (
    flowId: unknown,
    flowVersion: unknown,
  ): WorkflowVersion | undefined => {
    const template = workflows.templates.find((t) => t.id === flowId);
    return template?.versions.find(
      (v) => v.version === flowVersion,
    ) as WorkflowVersion | undefined;
  };

  // 未开工航班不应有任何作业任务
  if (
    services.some((s) => {
      const flight = flights.find((f) => f.id === s.flightId);
      return flight && (flight.status === "scheduled" || flight.status === "incoming");
    })
  )
    return false;
  if (
    !services.every(
      (s) =>
        text(s.flowId) &&
        finite(s.flowVersion) &&
        flightIds.has(s.flightId) &&
        text(s.stepId) &&
        Number.isInteger(s.copyIndex) &&
        (s.copyIndex as number) >= 0 &&
        serviceKinds.includes(s.kind as ServiceKind) &&
        serviceStates.includes(s.status as string) &&
        finite(s.progress) &&
        s.progress >= 0 &&
        s.progress <= 100 &&
        finite(s.duration) &&
        s.duration > 0 &&
        (s.vehicleId === undefined || vehicleIds.has(s.vehicleId)) &&
        (s.legacy === undefined || typeof s.legacy === "boolean") &&
        (!s.legacy || s.status === "done"),
    )
  )
    return false;

  // 每项作业必须归属到真实存在的流程版本与步骤；
  // legacy 遗留作业保留它完成时的旧版本号，当前版本中允许没有对应步骤
  for (const s of services) {
    const flight = flights.find((f) => f.id === s.flightId)!;
    const current = versionOf(flight.flowId, flight.flowVersion);
    if (!current) return false;
    if (s.flowId !== flight.flowId) return false;
    if (s.legacy) {
      // 旧版成果：版本号必须指向该模板中一个真实的历史版本
      const origin = versionOf(s.flowId, s.flowVersion);
      if (!origin) return false;
      const originStep = origin.steps.find((step) => step.id === s.stepId);
      if (!originStep || originStep.kind !== s.kind) return false;
      // 当前版本不得再包含同一步骤，否则不应标记为 legacy
      if (current.steps.some((step) => step.id === s.stepId)) return false;
      continue;
    }
    if (s.flowVersion !== flight.flowVersion) return false;
    const step = current.steps.find((step) => step.id === s.stepId);
    if (!step) return false;
    if (step.kind !== s.kind) return false;
    if ((s.copyIndex as number) >= step.copies) return false;
  }

  // 每个当前版本步骤的副本齐全（legacy 之外）
  for (const flight of started) {
    const version = versionOf(flight.flowId, flight.flowVersion)!;
    for (const step of version.steps) {
      const group = services.filter(
        (s) => s.flightId === flight.id && s.stepId === step.id && !s.legacy,
      );
      if (group.length !== step.copies) return false;
      if (new Set(group.map((s) => s.copyIndex)).size !== group.length)
        return false;
    }
  }

  const occupied = flights
    .filter((f) => f.status !== "departed" && f.standId !== undefined)
    .map((f) => f.standId);
  if (new Set(occupied).size !== occupied.length) return false;
  if (
    !flights.every(
      (f) =>
        !["parked", "departing", "departed"].includes(f.status as string) ||
        (standIds.has(f.standId) &&
          (f.size === "narrow" ||
            stands.find((s) => s.id === f.standId)?.size === "wide")),
    )
  )
    return false;
  if (
    !services.every((s) => {
      if (s.status === "pending")
        return s.progress === 0 && s.vehicleId === undefined;
      const v = vehicles.find((x) => x.id === s.vehicleId);
      if (!v || v.kind !== s.kind) return false;
      if (s.status === "done") return s.progress === 100;
      return (
        v.serviceId === s.id &&
        v.status === s.status &&
        flights.find((f) => f.id === s.flightId)?.status === "parked"
      );
    })
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        !["travel", "working"].includes(v.status as string) ||
        services.some(
          (s) =>
            s.id === v.serviceId &&
            s.vehicleId === v.id &&
            s.status === v.status,
        ),
    )
  )
    return false;
  // 同时作业数量不得超过该航班钉住版本的服务位上限，且不得违反安全互斥
  for (const flight of started) {
    const version = versionOf(flight.flowId, flight.flowVersion)!;
    const active = services.filter(
      (t) =>
        t.flightId === flight.id &&
        !t.legacy &&
        ["travel", "working"].includes(t.status as string),
    );
    if (active.length > version.maxConcurrent) return false;
    for (const a of active)
      for (const b of active)
        if (
          (a.id as string) < (b.id as string) &&
          jobCatalog[a.kind as ServiceKind].conflictsWith.includes(
            b.kind as ServiceKind,
          )
        )
          return false;
  }
  if (
    !flights.every(
      (f) =>
        !["departing", "departed"].includes(f.status as string) ||
        (() => {
          const version = versionOf(f.flowId, f.flowVersion)!;
          return version.steps.every((step) =>
            services
              .filter((t) => t.flightId === f.id && t.stepId === step.id && !t.legacy)
              .every((t) => t.status === "done"),
          );
        })(),
    )
  )
    return false;
  if (
    !value.events.every(
      (e) =>
        row(e) &&
        finite(e.id) &&
        finite(e.time) &&
        text(e.text) &&
        ["info", "success", "warning"].includes(e.tone as string),
    )
  )
    return false;
  const events = value.events as Row[];
  if (
    new Set(events.map((e) => e.id)).size !== events.length ||
    events.some((e) => (e.id as number) >= (value.nextEventId as number))
  )
    return false;
  return (
    flightIds.has(value.selectedFlightId) &&
    (value.selectedStandId === undefined ||
      standIds.has(value.selectedStandId)) &&
    (value.selectedVehicleId === undefined ||
      vehicleIds.has(value.selectedVehicleId))
  );
}
