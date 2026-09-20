/**
 * Preferences owned by FUSE itself, persisted to localStorage.
 *
 * Most settings arrive from the host via `SetupData`, but the host has no
 * concept of these, so we keep them here. Same `ogs-fuse-*` key convention
 * as the shot data panel ordering in UIShotData.
 */

export const PLAYER_ROTATIONS = ['furthest', 'sequential'] as const;
export type PlayerRotation = (typeof PLAYER_ROTATIONS)[number];

const PLAYER_ROTATION_KEY = 'ogs-fuse-playerRotation';

export const ROTATION_LABELS: Record<PlayerRotation, string> = {
  furthest: 'Furthest from pin',
  sequential: 'In order'
};

export function getPlayerRotation(): PlayerRotation {
  try {
    const stored = localStorage.getItem(PLAYER_ROTATION_KEY);
    if (PLAYER_ROTATIONS.includes(stored as PlayerRotation)) {
      return stored as PlayerRotation;
    }
  } catch (error) {
    console.warn('Unable to read player rotation preference', error);
  }
  // matches the behavior before this was configurable
  return 'furthest';
}

export function setPlayerRotation(mode: PlayerRotation) {
  try {
    localStorage.setItem(PLAYER_ROTATION_KEY, mode);
  } catch (error) {
    console.warn('Unable to save player rotation preference', error);
  }
}
