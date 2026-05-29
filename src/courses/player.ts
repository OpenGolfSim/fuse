import * as THREE from 'three';

export interface CoursePlayer extends OpenGolfSim.Player {}

export class CoursePlayer {
  // all properties of OpenGolfSim.Player + 
  strokes = 0;
  disabled: boolean;
  currentClub: OpenGolfSim.Club;
  previousStart?: THREE.Vector3;
  originalStart?: THREE.Vector3;
  originalAim?: THREE.Vector3;
  start: THREE.Vector3;
  aim?: THREE.Vector3;
  pin?: THREE.Vector3;
  scorecard: Map<string, number>;

  constructor(player: OpenGolfSim.Player) {
    // how could I just set these?
    this.name = player.name;
    this.id = player.id;
    this.clubs = player.clubs;
    this.disabled = false;
    
    this.currentClub = player.clubs[0]; // select first
    this.scorecard = new Map();
    this.start = new THREE.Vector3(0, 0, 0);
  }

  hasFinishedHole(holeNumber: string) {
    return this.scorecard.has(holeNumber);
  }

  resetPositions(holeStart: THREE.Vector3, holePin: THREE.Vector3, holeAim?: THREE.Vector3) {
    // TODO: autoselect club based on aim distance?
    this.currentClub = this.clubs[0];
    this.previousStart = undefined;
    this.originalStart = holeStart.clone();
    this.start = holeStart.clone();
    this.pin = holePin.clone();
    
    this.originalAim = holeAim?.clone();
    this.aim = holeAim?.clone();
  }
}