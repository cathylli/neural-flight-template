// Public surface of the stations module. Importers use "./stations" exactly as
// before; the implementation is split across this folder.
export { StationManager, STATION_TILE_WEIGHT } from "./StationManager";
export type { StationSpawnPolicy } from "./StationManager";
export type { StationContext, StationVisual, StationFactory } from "./types";
