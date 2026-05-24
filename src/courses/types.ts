import * as THREE from 'three';

export type HoleWaypoint = Map<string, THREE.Vector3>;

export type Hole = {
  number: string;
  par: number;
  waypoints: HoleWaypoint;
}

export type PlayerState = {
  strokes: number,
  club: OpenGolfSim.Club,
  scorecard: Map<string, number>,
  previousStart?: THREE.Vector3,
  originalStart: THREE.Vector3,
  originalAim?: THREE.Vector3,
  start: THREE.Vector3,
  aim?: THREE.Vector3,
  pin: THREE.Vector3
}