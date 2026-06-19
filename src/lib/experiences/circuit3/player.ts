import type { ExperienceState } from "../types";
import type { WFCState } from "./scene";

export function updatePlayer(
  orientation: { pitch: number; roll: number },
  _speed: { accelerate: boolean; brake: boolean },
  state: ExperienceState,
  delta: number,
): void {
  const s = state as WFCState;

  const moveZ = -orientation.pitch * s.moveSpeed * delta;
  const moveX = orientation.roll * s.moveSpeed * delta;

  s.camera.position.x += moveX;
  s.camera.position.z += moveZ;

  // Keep fixed height above the data room floor
  s.camera.position.y = 3;
}
