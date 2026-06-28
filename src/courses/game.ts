import * as THREE from 'three';
import { CourseLoader } from './loader';
import { Hole, PlayerState } from './types';
import { type GolfBallEvents, type GolfBall } from '@/objects/golfBall';
import EventEmitter from 'eventemitter3';
import { CoursePlayer } from './player';
import { DefaultGimmeDistances } from '@/utils/data';

// how far away from the tee box position to auto-aim at the pin instead of aim point
const AIMPOINT_THRESHOLD = 25;

interface CourseGameEvents {
  nextShot: (player: CoursePlayer) => void;
  roundEnded: () => void;
}
// export type PlayerStatus = {
//   player: CoursePlayer;
//   state: Partial<PlayerState>;
// }
type CourseGameOptions = {
  setupData: OpenGolfSim.SetupData,
}

export class CourseGame extends EventEmitter<CourseGameEvents> {
  course: CourseLoader;
  golfBall: GolfBall;
  players: CoursePlayer[];
  practiceMode: boolean;
  currentPlayerIndex: number;
  currentHoleIndex: number;
  activePlayer: CoursePlayer;
  activeHole: Hole;
  puttingEnabled: boolean;
  gimmeDistances: number[];
  #orderedHoles: Hole[];
  // #playerData: Map<string, PlayerState>;

  constructor(course: CourseLoader, golfBall: GolfBall, options: CourseGameOptions) {
    super();
    this.course = course;
    this.players = options?.setupData.players.map(player => new CoursePlayer(player));
    this.practiceMode = !!options?.setupData.practiceMode;
    this.golfBall = golfBall;
    this.gimmeDistances = options?.setupData.gimmeDistances || DefaultGimmeDistances;
    this.puttingEnabled = !!options?.setupData.puttingEnabled;

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

  _addStrokes(strokes = 1, endOfHole = false) {
    this.activePlayer.strokes += strokes;
    const holeKey = `${this.activeHole.number}`;
    const existingHoleScore = this.activePlayer.scorecard.get(holeKey);
    // finalize player hole score
    const newHoleScore = existingHoleScore ? existingHoleScore + strokes : strokes;
    this.activePlayer.scorecard.set(holeKey, newHoleScore);
    
    if (endOfHole) {
      const diff = (newHoleScore - this.activeHole.par);
      console.log(`Adding diff to par score: ${diff}`);
      this.activePlayer.toPar += diff;
    }
  }

  _onShotEnded(...[details]: Parameters<GolfBallEvents['shotEnded']>) {
    const { surface } = details;
    if (!this.activePlayer) {
      throw new Error('No player found!');
    }
    this._addStrokes();

    // store for mulligans
    if (!this.activePlayer.previousStart) {
      this.activePlayer.previousStart = new THREE.Vector3();
    }
    this.activePlayer.previousStart.copy(this.activePlayer.start);
  
    if (!this.practiceMode) {
      if (!this.golfBall.object) {
        throw new Error('GolfBall object not found');
      }
      this.activePlayer.start.copy(this.golfBall.object.position);
      // hack greens as done
      if (this.golfBall.physics?.isHoled) {
        this.activePlayer.disabled = true;
        this._nextPlayer();
        this._addStrokes(0, true);
      } else if (surface?.type === 'green' && !this.puttingEnabled) {
        // total score
        // TODO: change to add auto-putt number
        const holePos = this.activeHole.waypoints.get('pin');
        const distanceToHole = holePos?.distanceTo(this.golfBall.object.position) || Infinity;
        let autoPutt = 3;
        if (distanceToHole <= this.gimmeDistances[0]) {
          autoPutt = 1;
        } else if (distanceToHole <= this.gimmeDistances[1]) {
          autoPutt = 2;
        }
        console.log(`Distance to hole: ${distanceToHole}m, auto-putt score: ${autoPutt}`);
        this._addStrokes(autoPutt, true);
        
        // disable player when they finish a hole (so they are not selectable in UI)
        this.activePlayer.disabled = true;
        this._nextPlayer();
      }
    }


    this.updateAimPoint(this.activePlayer.start);    
    this.emit('nextShot', this.activePlayer);
  }

  switchHole(hole: Hole) {
    this.currentHoleIndex = this.#orderedHoles.findIndex(h => h.number === hole.number);
    this.activeHole = this.#orderedHoles[this.currentHoleIndex]
    this._setupHole();
  }

  _nextHole() {
    const nextUnfinishedHole = this.#orderedHoles.findIndex(hole => !this.#allPlayersFinishedHole(hole.number));
    if (nextUnfinishedHole === -1) {
      console.log('Course finished!');
      this.emit('roundEnded');
      return;
    }
    this.currentHoleIndex = nextUnfinishedHole;
    this.activeHole = this.#orderedHoles[this.currentHoleIndex]
    this._setupHole();
  }

  #findNextPlayerUp() {
    // default rotation type
    // loop through until we find the next player that hasn't finished the hole
    for (let i = 1; i <= this.players.length; i++) {
      const index = (this.currentPlayerIndex + i) % this.players.length;
      const finished = this.players[index].hasFinishedHole(this.activeHole.number);
      if (!finished) {
        return index;
      }
    }
    return -1;
  }

  #allPlayersFinishedHole(holeNumber?: string) {
    return this.players.every(player => player.hasFinishedHole(holeNumber ? holeNumber : this.activeHole.number))
  }

  _nextPlayer() {
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
    const hole = this.course.holes.get(parseInt(this.activeHole.number));
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
  
  autoSelectClub() {
    if (!this.golfBall.object) {
      console.error('No golf ball object!');
      return;
    }
    // console.error('Current surface', this.golfBall);

    if (this.golfBall.isOnGreen(true)) {
      this.activePlayer.currentClub = this.activePlayer.clubs[this.activePlayer.clubs.length - 1];
      return;
    }
    const holePos = this.activeHole.waypoints.get('pin');
    const distanceToHole = holePos?.distanceTo(this.golfBall.object.position) || Infinity;    

    // sort by shortest distance (minus putter)...
    const sortedClubs = [...this.activePlayer.clubs.slice(0, -1)].sort((a, b) => a.distance > b.distance ? -1 : 1);
    for (const club of sortedClubs) {
      if (club.distance <= distanceToHole) {
        console.log(`Auto-selecting club: ${club.id}, distanceToHole: ${distanceToHole}`);
        this.activePlayer.currentClub = club;
        return;
      }
    }
    this.activePlayer.currentClub = sortedClubs[sortedClubs.length - 1];
  }
  
  selectClub(club: OpenGolfSim.Club) {
    this.activePlayer.currentClub = club;
  }

  update(dt: number) {
    const hole = this.course.holes.get(parseInt(this.activeHole.number));
    if (hole?.green?.target) {
      hole.green.target.update(this.golfBall, dt);
      hole.green.flag.update(dt);
    }
  }

}
