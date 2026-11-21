import type { Shift } from "../../../shared/types";
import { initialFlights } from "../../flights";
import { initialStands } from "../../apron";
import { initialVehicles } from "../../fleet";
import { defaultTemplates } from "../../workflow/model/catalog";

export function createShift(): Shift {
  const flights = initialFlights();
  return {
    version: 2,
    time: 0,
    paused: false,
    speed: 1,
    score: 0,
    conflicts: 0,
    flights,
    stands: initialStands(),
    services: [],
    vehicles: initialVehicles(),
    workflows: { templates: defaultTemplates() },
    events: [
      { id: 0, time: 0, text: "早班开始 · 3 架航班等待机位分配", tone: "info" },
    ],
    selectedFlightId: "MU2451",
    nextEventId: 1,
  };
}
