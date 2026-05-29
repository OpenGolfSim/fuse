import * as THREE from 'three';
import { CourseLoader } from './loader';
import { Hole, PlayerState } from './types';
import { type GolfBallEvents, type GolfBall } from '@/objects/golfBall';
import EventEmitter from 'eventemitter3';
import { CoursePlayer } from './player';

// how far away from the tee box position to auto-aim at the pin instead of aim point
const AIMPOINT_THRESHOLD = 25;

interface CourseGameEvents {
  nextShot: (player: CoursePlayer) => void;
}
// export type PlayerStatus = {
//   player: CoursePlayer;
//   state: Partial<PlayerState>;
// }

export class CourseGame extends EventEmitter<CourseGameEvents> {
  course: CourseLoader;
  golfBall: GolfBall;
  players: CoursePlayer[];
  practiceMode: boolean;
  currentPlayerIndex: number;
  currentHoleIndex: number;
  activePlayer: CoursePlayer;
  activeHole: Hole;

  #orderedHoles: Hole[];
  // #playerData: Map<string, PlayerState>;

  constructor(course: CourseLoader, golfBall: GolfBall, setupData: OpenGolfSim.SetupData, options = {}) {
    super();
    this.course = course;
    this.players = setupData.players.map(player => new CoursePlayer(player));
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

    // this.#playerData = new Map();

    this.golfBall.on('shotEnded', (details) => this._onShotEnded(details));
    
    // setup first hole
    this._setupHole();
  }

  // currentPlayer(): CoursePlayer {
    // const state = this.#playerData.get(this.activePlayer.id);
    // if (!state) {
    //   throw new Error('Unable to lookup player state');
    // }
    // return {
    //   state,
    //   player: this.activePlayer
    // }
  // }
  
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
    this.players.forEach((player, index) => {
      player.disabled = false;
      player.resetPositions(holeStart, holePin, holeAim);
    });
  }
  
  pinPoint(): THREE.Vector3 {
    const pos = this.activePlayer.pin;
    if (!pos) throw new Error('Unable to find PIN position');
    return pos;
  }
  
  startPoint(): THREE.Vector3 {
    const pos = this.activePlayer.start;
    if (!pos) throw new Error('Unable to find START position');
    return pos;
  }

  updateStartPoint(point: THREE.Vector3) {
    this.activePlayer.start.copy(point);
    this.updateAimPoint(point);
  }
  
  aimPoint(): THREE.Vector3 {
    // const pos = this.#playerData.get(this.activePlayer.id)?.aim || this.#playerData.get(this.activePlayer.id)?.pin;
    const pos = this.activePlayer.aim || this.activePlayer.pin;
    if (!pos) throw new Error('Unable to find AIM position');
    return pos;
  }

  updateAimPoint(position: THREE.Vector3) {
    // const playerState = this.#playerData.get(this.activePlayer.id);
    // if (!playerState) {
    //   throw new Error('No player found!');
    // }
    const distFromStart = this.activePlayer.originalStart?.distanceTo(position) || 0;
    if (this.activePlayer.pin && distFromStart > AIMPOINT_THRESHOLD) {
      // playerState.aim ? playerState.aim.copy(playerState.pin) : playerState.aim = playerState.pin.clone();
      this.activePlayer.aim = this.activePlayer.pin.clone();
    }
  }

  _onHoleEnded() {
    console.log('_onHoleEnded');
  }

  _onShotEnded(...[details]: Parameters<GolfBallEvents['shotEnded']>) {
    const { surface } = details;
    // let playerState = this.#playerData.get(this.activePlayer.id);
    console.log('SHOT ENDED', this.activePlayer);
    if (!this.activePlayer) {
      throw new Error('No player found!');
    }
    this.activePlayer.strokes++;

    // store for mulligans
    if (!this.activePlayer.previousStart) {
      this.activePlayer.previousStart = new THREE.Vector3();
    }
    this.activePlayer.previousStart.copy(this.activePlayer.start);
  
    console.log('playerState', this.activePlayer);
    if (!this.practiceMode) {
      if (!this.golfBall.object) {
        throw new Error('GolfBall object not found');
      }
      this.activePlayer.start.copy(this.golfBall.object.position);
      // hack greens as done
      if (surface?.type === 'green') {
        // 1-auto putt
        this.activePlayer.strokes++;
        // finalize player hole score
        this.activePlayer.scorecard.set(this.activeHole.number, this.activePlayer.strokes);
        // disable player when they finish a hole, so it's not selectable in UI
        this.activePlayer.disabled = true;
        this._nextPlayer();
        // const p = this.#playerData.get(this.activePlayer.id);
        // if (p) {
        //   playerState = p;
        // }
      }
    }


    this.updateAimPoint(this.activePlayer.start);    
    this.emit('nextShot', this.activePlayer);
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

  #findNextPlayerUp() {
    // standard rotation type
    // loop through until we find the next player that hasn't finished the hole
    for (let i = 1; i <= this.players.length; i++) {
      const index = (this.currentPlayerIndex + i) % this.players.length;
      // const playerState = this.#playerData.get(this.players[index].id);
      const finished = this.players[index].hasFinishedHole(this.activeHole.number);
      console.log(`index: ${index}, finished: ${finished}`);
      if (!finished) {
        return index;
      }
    }
    return -1;
  }

  #allPlayersFinishedHole() {
    return this.players.every(player => player.hasFinishedHole(this.activeHole.number))
  }

  _nextPlayer() {
    const allDone = this.#allPlayersFinishedHole();
    if (this.#allPlayersFinishedHole()) {
      console.log('All players have finished hole');
      // TODO: respect honors of last hole?
      this.currentPlayerIndex = 0;
      this._nextHole();
    } else {
      const nextUp = this.#findNextPlayerUp();
      if (nextUp === -1) {
        throw new Error('Could not determine next player!');
      }
      this.currentPlayerIndex = nextUp;
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

  selectPlayer(player: OpenGolfSim.Player) {
    const newIndex = this.players.findIndex(p => p.id === player.id);
    if (newIndex > -1) {
      this.currentPlayerIndex = newIndex;
      this.activePlayer = this.players[this.currentPlayerIndex];
      // let playerState = this.#playerData.get(this.activePlayer.id);
      // if (!playerState) throw new Error('Missing player state data');
      this.emit('nextShot', this.activePlayer);
    }
  }

  selectClub(club: OpenGolfSim.Club) {
    // let playerState = this.#playerData.get(this.activePlayer.id);
    // if (!playerState) {
    //   throw new Error('No player found!');
    // }
    this.activePlayer.currentClub = club;
  }

  update(dt: number) {
    const hole = this.course.holes.get(this.activeHole.number);
    if (hole?.green?.target) {
      hole.green.target.update(this.golfBall, dt);
      hole.green.flag.update(dt);
    }
  }

}
