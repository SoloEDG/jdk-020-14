import type { WorkflowVersion } from "../../../shared/types";
import { jobCatalog, serviceKinds } from "../model/catalog";
import { compareModes } from "../lib/estimate";
import { fleetCounts } from "../../fleet/model/vehicles";
import type { WorkflowDraft } from "../model/editor";

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds)) return "车辆不足";
  return `${Math.round(seconds)} 秒`;
}

export function EstimatePanel({
  draft,
  size,
}: {
  draft: WorkflowDraft;
  size: "narrow" | "wide";
}) {
  const candidate: WorkflowVersion = {
    ...draft,
    version: 0,
    createdAt: 0,
  };
  const comparison = compareModes(candidate, size, fleetCounts);
  const active =
    draft.mode === "serial" ? comparison.serial : comparison.parallel;
  const other =
    draft.mode === "serial" ? comparison.parallel : comparison.serial;
  const saved = other.makespan - active.makespan;
  const demandKinds = serviceKinds.filter(
    (k) => (active.demand[k] ?? 0) > 0 || (other.demand[k] ?? 0) > 0,
  );

  return (
    <div className="estimate-panel">
      <div className="subheading">
        <h3>方案比较 · 预计完成时间</h3>
        <span>WHAT-IF SCHEDULE</span>
      </div>
      <div className="compare-grid">
        <div className={draft.mode === "parallel" ? "picked" : ""}>
          <span>尽量并行</span>
          <strong>{fmt(comparison.parallel.makespan)}</strong>
          <small>
            峰值占用 {comparison.parallel.peakConcurrent} 个服务位
          </small>
        </div>
        <div className={draft.mode === "serial" ? "picked" : ""}>
          <span>全部串行</span>
          <strong>{fmt(comparison.serial.makespan)}</strong>
          <small>峰值占用 1 个服务位</small>
        </div>
      </div>
      <p className="estimate-hint">
        {Number.isFinite(saved) && saved !== 0
          ? `当前选择与另一方案相差约 ${Math.round(Math.abs(saved))} 秒：并行省时但多占现场位置，串行节省资源却可能错过离港。`
          : "两种方案预计耗时接近，可优先选择占用现场位置更少的串行方案。"}
      </p>
      <div className="demand-list">
        <span>车辆需求（同时占用峰值 / 在编）：</span>
        {demandKinds.map((k) => {
          const need = active.demand[k] ?? 0;
          const short = need > fleetCounts[k];
          return (
            <em key={k} className={short ? "short" : ""}>
              {jobCatalog[k].vehicleLabel} {need}/{fleetCounts[k]}
              {short && " · 不足"}
            </em>
          );
        })}
        {active.shortages.length > 0 && (
          <b className="short">
            缺少 {active.shortages.map((k) => jobCatalog[k].vehicleLabel).join("、")}
            ，该方案无法完成
          </b>
        )}
      </div>
    </div>
  );
}
