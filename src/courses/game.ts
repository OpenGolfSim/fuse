import * as THREE from 'three';
import { CourseLoader } from './loader';
import { Hole, PlayerState } from './types';
import { type GolfBallEvents, type GolfBall } from '@/objects/golfBall';
import EventEmitter from 'eventemitter3';

// how far away from the tee box position to auto-aim at the pin instead of aim point
const AIMPOINT_THRESHOLD = 25;

interface CourseGameEvents {
  nextShot: (status: PlayerStatus) => void;
}
export type PlayerStatus = {
  player: OpenGolfSim.Player;
  state: PlayerState;
}

export class CourseGame extends EventEmitter<CourseGameEvents> {
  course: CourseLoader;
  golfBall: GolfBall;
  players: OpenGolfSim.Player[];
  practiceMode: boolean;
  currentPlayerIndex: number;
  currentHoleIndex: number;
  activePlayer: OpenGolfSim.Player;
  activeHole: Hole;

  #orderedHoles: Hole[];
  #playerData: Map<string, PlayerState>;

  constructor(course: CourseLoader, golfBall: GolfBall, setupData: OpenGolfSim.SetupData, options = {}) {
    super();
    this.course = course;
    this.players = setupData.players;
    this.practiceMode = !!setupData.practiceMode;
    this.golfBall = golfBall;

    this.currentPlayerIndex = 0;
    this.currentHoleIndex = 0;
    this.#orderedHoles = Array.from(this.course.holes.values()).sort((a, b) => (a.number < b.number ? -1 : 1));
    if (!this.#orderedHoles.length) {
      throw new Error('Course has no holes!');
    }
    
    this.activePlayer = this.players[this.currentPlayerIndex];
    this.activeHole = this.#orderedHoles[this.currentHoleIndex];

    this.#playerData = new Map();

    this.golfBall.on('shotEnded', (details) => this._onShotEnded(details));
    
    // setup first hole
    this._setupHole();
  }

  currentPlayer(): PlayerStatus {
    const state = this.#playerData.get(this.activePlayer.id);
    if (!state) {
      throw new Error('Unable to lookup player state');
    }
    return {
      state,
      player: this.activePlayer
    }
  }
  
  _setupHole() {
    const hole = this.activeHole;
    const holeStart = hole.waypoints.get('tee');
    const holeAim = hole.waypoints.get('aim');
    const holePin = hole.waypoints.get('pin');
    if (!holeStart) {
      throw new Error('Missing hole start position!');
    }
    if (!holePin) {
      throw new Error('Missing hole pin position!');
    }
    // set initial player positions
    this.players.forEach(player => {
      this.#playerData.set(player.id, {
        strokes: 0,
        scorecard: new Map(),
        club: player.clubs[0],
        previousStart: undefined,
        originalStart: holeStart.clone(),
        originalAim: holeAim?.clone(),
        start: holeStart.clone(),
        aim: holeAim?.clone(),
        pin: holePin.clone()
      });
    });
  }
  
  pinPoint(): THREE.Vector3 {
    const pos = this.#playerData.get(this.activePlayer.id)?.pin;
    if (!pos) throw new Error('Unable to find PIN position');
    return pos;
  }
  
  startPoint(): THREE.Vector3 {
    const pos = this.#playerData.get(this.activePlayer.id)?.start;
    if (!pos) throw new Error('Unable to find START position');
    return pos;
  }

  updateStartPoint(point: THREE.Vector3) {
    const item = this.#playerData.get(this.activePlayer.id);
    if (item) {
      item.start.copy(point);
    }
    this.updateAimPoint(point);
  }
  
  aimPoint(): THREE.Vector3 {
    const pos = this.#playerData.get(this.activePlayer.id)?.aim || this.#playerData.get(this.activePlayer.id)?.pin;
    if (!pos) throw new Error('Unable to find AIM position');
    return pos;
  }

  updateAimPoint(position: THREE.Vector3) {
    const playerState = this.#playerData.get(this.activePlayer.id);
    if (!playerState) {
      throw new Error('No player found!');
    }
    const distFromStart = playerState.originalStart.distanceTo(position);
    if (distFromStart > AIMPOINT_THRESHOLD) {
      // playerState.aim ? playerState.aim.copy(playerState.pin) : playerState.aim = playerState.pin.clone();
      playerState.aim = playerState.pin.clone();
    }
  }

  _onHoleEnded() {
    console.log('_onHoleEnded');
  }

  _onShotEnded(...[details]: Parameters<GolfBallEvents['shotEnded']>) {
    const { surface } = details;
    let playerState = this.#playerData.get(this.activePlayer.id);
    if (!playerState) {
      throw new Error('No player found!');
    }
    playerState.strokes++;

    // store for mulligans
    if (!playerState.previousStart) {
      playerState.previousStart = new THREE.Vector3();
    }
    playerState.previousStart.copy(playerState.start);
  
    console.log('playerState', playerState);
    if (!this.practiceMode) {
      if (!this.golfBall.object) {
        throw new Error('GolfBall object not found');
      }
      playerState.start.copy(this.golfBall.object.position);
      // hack greens as done
      if (surface?.type === 'green') {
        // 1-auto putt
        playerState.strokes++;
        // finalize player hole score
        playerState.scorecard.set(this.activeHole.number, playerState.strokes);
        this._nextPlayer();
        const p = this.#playerData.get(this.activePlayer.id);
        if (p) {
          playerState = p;
        }
      }
    }


    this.updateAimPoint(playerState.start);    
    this.emit('nextShot', { state: playerState, player: this.activePlayer });
  }

  _nextHole() {
    if ((this.currentHoleIndex + 1) === this.#orderedHoles.length) {
      console.log('Course finished!');
      return;
    }
    this.currentHoleIndex++;
    this.activeHole = this.#orderedHoles[this.currentHoleIndex]
    this._setupHole();
  }

  _nextPlayer() {
    console.log('Player finished!');
    if ((this.currentPlayerIndex + 1) === this.players.length) {
      console.log('Hole finished!');
      this.currentPlayerIndex = 0;
      this._nextHole();
    } else {
      this.currentPlayerIndex += 1;
    }
    this.activePlayer = this.players[this.currentPlayerIndex];
  }

  currentHole() {
    const hole = this.course.holes.get(this.activeHole.number);
    if (!hole) {
      throw new Error(`Missing hole ${this.activeHole.number}!`);
    }
    return hole;
  }

  update(dt: number) {
    const hole = this.course.holes.get(this.activeHole.number);
    if (hole?.green?.target) {
      hole.green.target.update(this.golfBall, dt);
      hole.green.flag.update(dt);
    }
  }

}
