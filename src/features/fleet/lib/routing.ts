import type { Point, Vehicle, ServiceKind } from "../../../shared/types";
export function tripSeconds(a: Point, b: Point): number {
  return 5 + Math.hypot(a.x - b.x, a.y - b.y) / 50;
}
export function routePosition(v: Vehicle): Point {
  const t = Math.min(1, v.progress / 100);
  return {
    x: v.origin.x + (v.target.x - v.origin.x) * t,
    y: v.origin.y + (v.target.y - v.origin.y) * t,
  };
}
export const vehicleLabels: Record<ServiceKind, string> = {
  fuel: "加油车",
  baggage: "行李拖车",
  clean: "清洁车",
  catering: "餐车",
  power: "电源车",
  water: "清水车",
  deice: "除冰车",
};
export const vehicleColors: Record<ServiceKind, string> = {
  fuel: "#e5a84e",
  baggage: "#529e9b",
  clean: "#7e8eb1",
  catering: "#c97f5f",
  power: "#d4b24a",
  water: "#5f9ec9",
  deice: "#8fb9d6",
};
