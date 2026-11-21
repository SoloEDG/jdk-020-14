import type { Shift } from "../../../shared/types";
import {
  jobCatalog,
  latestVersion,
  modeLabel,
  pinnedVersionOf,
  planMigration,
} from "../../workflow";
import { flightTasks, taskBlockReason } from "../lib/eligibility";
import type { MigrationPlan } from "../../workflow";

interface Props {
  state: Shift;
  onDispatch: (taskId: string, vehicleId: string) => void;
  onOpenWorkflow: () => void;
  onPlanMigration: (plan: MigrationPlan) => void;
}

export function ServicePanel({
  state,
  onDispatch,
  onOpenWorkflow,
  onPlanMigration,
}: Props) {
  const flight = state.flights.find((f) => f.id === state.selectedFlightId);
  if (!flight) return null;
  const pinned = pinnedVersionOf(state, flight);
  const template = state.workflows.templates.find((t) => t.id === flight.size);
  const latest = template ? latestVersion(template) : undefined;
  const tasks = flightTasks(state, flight.id);
  const legacyTasks = state.services.filter(
    (t) => t.flightId === flight.id && t.legacy,
  );
  const started = flight.status === "parked";
  const hasNewVersion =
    started &&
    !!pinned &&
    !!latest &&
    latest.version !== pinned.version;
  let previewPlan: MigrationPlan | undefined;
  if (hasNewVersion && pinned && latest) {
    previewPlan = planMigration(
      flight,
      state.services.filter((t) => t.flightId === flight.id),
      pinned,
      latest,
    );
  }

  return (
    <div className="service-panel">
      <div className="subheading">
        <h3>地勤保障</h3>
        <button className="mini-link" onClick={onOpenWorkflow}>
          流程编辑 ↗
        </button>
      </div>

      {pinned ? (
        <p className="flow-badge">
          实际采用 {flight.size === "wide" ? "宽体机" : "窄体机"}流程 v
          {pinned.version} · {modeLabel(pinned.mode)} · 服务位上限{" "}
          {pinned.maxConcurrent}
          {hasNewVersion && latest && (
            <button
              className="new-version"
              onClick={() => previewPlan && onPlanMigration(previewPlan)}
              data-testid="plan-migration"
            >
              可迁移至 v{latest.version} →
            </button>
          )}
        </p>
      ) : (
        <p className="flow-badge muted">
          未开工 · 默认采用 {latest ? `v${latest?.version}` : "—"}
          ，分配机位后钉住
        </p>
      )}

      {tasks.map((t) => {
        const info = jobCatalog[t.kind];
        const reason = started ? taskBlockReason(state, t) : "等待航班停靠";
        const available = state.vehicles.filter(
          (v) => v.kind === t.kind && v.status === "idle",
        );
        const selected =
          state.vehicles.find((v) => v.id === state.selectedVehicleId && v.kind === t.kind) ??
          available[0];
        const copyTag = t.copyIndex > 0 ? ` #${t.copyIndex + 1}` : "";
        return (
          <div className={`service-task ${t.status}`} key={t.id}>
            <div className="service-icon">{info.icon}</div>
            <div className="service-content">
              <div className="service-title">
                <strong>
                  {info.label}
                  {copyTag}
                </strong>
                <span>
                  {t.status === "done"
                    ? "已完成 ✓"
                    : t.status === "working"
                      ? `${Math.floor(t.progress)}%`
                      : t.status === "travel"
                        ? "车辆前往中"
                        : info.english}
                </span>
              </div>
              <div className="service-detail">
                {t.status === "pending"
                  ? reason ??
                    `${selected?.id ?? "暂无空闲车辆"} · ${info.vehicleLabel} · ${Math.round(t.duration)}s`
                  : `${t.vehicleId} · ${info.english}`}
              </div>
              {(t.status === "working" || t.status === "done") && (
                <div className="task-track">
                  <i style={{ width: `${t.progress}%` }} />
                </div>
              )}
            </div>
            {t.status === "pending" && (
              <button
                className="dispatch"
                data-testid={`start-service-${t.stepId}-${t.copyIndex}`}
                disabled={!!reason || !selected}
                title={reason ?? info.description}
                onClick={() => selected && onDispatch(t.id, selected.id)}
              >
                派遣 ↗
              </button>
            )}
          </div>
        );
      })}

      {legacyTasks.length > 0 && (
        <div className="legacy-box">
          <span>旧版遗留成果（不参与离港检查）：</span>
          {legacyTasks.map((t) => (
            <em key={t.id}>
              {jobCatalog[t.kind].label}
              {t.copyIndex > 0 ? ` #${t.copyIndex + 1}` : ""} · v{t.flowVersion}
            </em>
          ))}
        </div>
      )}

      {previewPlan && !previewPlan.canMigrate && (
        <p className="migration-block-hint">
          ⛔ v{latest!.version} 无法迁移：
          {previewPlan.conflicts.find((c) => c.blocking)?.text}
          ，当前现场保持不变。
        </p>
      )}

      <p className="dependency-note">
        ↳ 前置关系、副本数量与安全互斥以该航班钉住的流程版本为准；并行省时但占用更多服务位。
      </p>
    </div>
  );
}
