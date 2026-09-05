import * as THREE from 'three';
import { CourseLoader } from './loader';
import { Hole, PlayerState } from './types';
import { type GolfBallEvents, type GolfBall } from '@/objects/golfBall';
import EventEmitter from 'eventemitter3';
import { CoursePlayer } from './player';
import { DefaultGimmeDistances } from '@/utils/data';
import { ShotEndEvent } from '@/physics/ballPhysics';
import { app } from '@/index';
import { OGSKeyCommands } from '@/app';

// how far away from the tee box position to auto-aim at the pin instead of aim point
const AIMPOINT_THRESHOLD = 25;
// drop search tuning
const DROP_RING_STEP = 1;        // meters between sampling rings
const DROP_RING_SAMPLES = 12;    // angular samples per ring
const DROP_RAY_HEIGHT = 10;      // cast downward from this height above candidate
const INVALID_DROP_SURFACES = ['plane_river', 'plane_lake', 'water', 'bunker', 'green'];

const SCORE_LABELS: Record<string, string> = {
  '-4': 'Condor',
  '-3': 'Albatross',
  '-2': 'Eagle',
  '-1': 'Birdie',
  '0': 'Par',
  '1': 'Bogey',
  '2': 'Double Bogey',
  '3': 'Triple Bogey',
  '4': 'Quadruple Bogey',
};
type ScoreResult = {
  score: number;
  toPar: number;
  player?: string;
  label?: string;
}
interface CourseGameEvents {
  nextShot: (player: CoursePlayer) => void;
  playerHoleEnded: (score: ScoreResult) => void;
  roundEnded: () => void;
  drop: () => void;
  mulligan: () => void;
  rehit: () => void;
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
  gameMode: OpenGolfSim.SetupData['gameMode'];
  // #playerData: Map<string, PlayerState>;

  constructor(course: CourseLoader, golfBall: GolfBall, options: CourseGameOptions) {
    super();
    this.course = course;
    this.gameMode = course.gameMode || 'course';
    this.players = options?.setupData.players.map(player => new CoursePlayer(player));
    this.practiceMode = !!options?.setupData.practiceMode;
    this.golfBall = golfBall;
    this.gimmeDistances = options?.setupData.gimmeDistances || DefaultGimmeDistances;
    this.puttingEnabled = !!options?.setupData.puttingEnabled;

    this.currentPlayerIndex = 0;
    this.currentHoleIndex = 0;
    this.#orderedHoles = Array.from(this.course.holes.values()).map(h => ({ ...h, _num: parseInt(h.number) })).sort((a, b) => (a._num < b._num ? -1 : 1));
    if (!this.#orderedHoles.length) {
      throw new Error('Course has no holes!');
    }
    
    this.activePlayer = this.players[this.currentPlayerIndex];
    this.activeHole = this.#orderedHoles[this.currentHoleIndex];
    // this.#playerData = new Map();

    this.golfBall.on('shotEnded', (details) => this._onShotEnded(details));
    
    // setup first hole
    this._setupHole();

    app.on('command', (key, state) => {
      switch (key.ogs_code) {
        case OGSKeyCommands.Drop:
          this.drop();
          break;
        case OGSKeyCommands.Mulligan:
          this.mulligan();
          break;
        case OGSKeyCommands.ReHit:
          this.rehit();
          break;
      }
    });
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
    if (!this.activePlayer.pin) {
      console.warn('No pin location!');
      return;
    }
    if (this.gameMode === 'minigolf') {
      this.activePlayer.aim = this.activePlayer.pin.clone();
    } else if (distFromStart > AIMPOINT_THRESHOLD) {
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
    console.log(`[score] (${this.activePlayer.name}) +${strokes} strokes`);
    console.log(`[score] (${this.activePlayer.name}) existing ${existingHoleScore}`);
    const newHoleScore = (existingHoleScore ?? 0) + strokes;
    console.log(`[score] (${this.activePlayer.name}) set new ${newHoleScore}`);
    this.activePlayer.scorecard.set(holeKey, newHoleScore);
    
    const scoreParDiff = newHoleScore - this.activeHole.par;
    
    if (endOfHole) {
      this.activePlayer.finishHole(holeKey);

      console.log(`[score] final ${newHoleScore}`);
      this.emit('playerHoleEnded', {
        player: this.activePlayer.name,
        score: newHoleScore,
        toPar: scoreParDiff,
        label: newHoleScore === 1 ? 'Hole in One!' : SCORE_LABELS?.[`${scoreParDiff}`]
      });
      this.activePlayer.toPar = this.#orderedHoles.reduce((prev, hole) => {
        const finished = this.activePlayer.hasFinishedHole(hole.number);
        if (!finished) { return prev; }
        const s = this.activePlayer.scorecard.get(`${hole.number}`);
        const diff = (s || 0) - hole.par;
        return prev + diff;
      }, 0);
    }
  }

  _onShotEnded(details: ShotEndEvent) {
    const { surface, holeNumber, isInWater } = details;
    if (!this.activePlayer) {
      throw new Error('No player found!');
    }
    this._addStrokes(1);

    // store for mulligans
    if (!this.activePlayer.previousStart) {
      this.activePlayer.previousStart = new THREE.Vector3();
    }
    this.activePlayer.previousStart.copy(this.activePlayer.start);
  

    if (!this.practiceMode) {
      // if (isInWater) {
      //   console.log('ball in water hazard!!');
      //   this.golfBall.object.visible = false;
      //   this.updateAimPoint(this.activePlayer.start);
      //   this.emit('nextShot', this.activePlayer);
      //   return;
      // }    
      if (!this.golfBall.object) {
        throw new Error('GolfBall object not found');
      }
      this.activePlayer.start.copy(this.golfBall.object.position);
      // hack greens as done
      if (this.golfBall.physics?.isHoled) {
        this.activePlayer.disabled = true;
        this._addStrokes(0, true);
        this._nextPlayer();
        console.log(`[score] Ball in hole! End hole`);
      } else if (surface === 'green' && !this.puttingEnabled && holeNumber === this.getActiveHoleNumber()) {
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

      if (isInWater) {
        return;
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

  getActiveHoleNumber() {
    return parseInt(this.activeHole.number) || 0;
  }
  
  update(dt: number) {
    // const hole = this.course.holes.get(parseInt(this.activeHole.number));
    // if (hole?.green?.target) {
    //   hole.green.target.update(this.golfBall, dt);
    //   hole.green.flag.update(dt);
    // }
  }

  rehit() {
    if (!this.activePlayer.previousStart) {
      console.warn('No previous position');
      return;
    }
    
    this.activePlayer.start.copy(this.activePlayer.previousStart);
    this.golfBall.isShotActive = false;
    this.updateAimPoint(this.activePlayer.start);
    this.emit('rehit');
    this.emit('nextShot', this.activePlayer);
  }

  mulligan() {
    if (!this.activePlayer.previousStart) {
      console.warn('No previous position');
      return;
    }
    this._addStrokes(-1);
    this.rehit();
    this.emit('mulligan');
  }

  drop() {
    const ballPos = this.golfBall.object?.position;
    const prev = this.activePlayer.previousStart;
    const pin = this.activePlayer.pin;
    if (!ballPos || !prev || !pin) {
      console.warn('Missing positions for drop');
      return;
    }

    const dropPoint = this._findDropPoint(ballPos, pin, prev);
    if (dropPoint) {
      this.activePlayer.start.copy(dropPoint);
    } else {
      // no valid surface found: stroke and distance
      console.warn('No valid drop point found, returning to previous position');
      this.activePlayer.start.copy(prev);
    }

    this._addStrokes(1); // penalty stroke
    this.golfBall.isShotActive = false;
    this.updateAimPoint(this.activePlayer.start);
    this.emit('drop');
    this.emit('nextShot', this.activePlayer);
  }

  _findDropPoint(ballPos: THREE.Vector3, pin: THREE.Vector3, prev: THREE.Vector3): THREE.Vector3 | null {
    const meshes = this.course.getGroundMeshes();
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = true; // requires three-mesh-bvh acceleration (already in use)

    const ballToPin = ballPos.distanceTo(pin);
    const ballToPrev = ballPos.distanceTo(prev);
    const maxRadius = ballToPrev; // beyond this, previousStart is strictly better

    const origin = new THREE.Vector3();
    const down = new THREE.Vector3(0, -1, 0);

    for (let radius = DROP_RING_STEP; radius <= maxRadius; radius += DROP_RING_STEP) {
      let best: THREE.Vector3 | null = null;
      let bestPinDist = Infinity;

      for (let i = 0; i < DROP_RING_SAMPLES; i++) {
        const angle = (i / DROP_RING_SAMPLES) * Math.PI * 2;
        origin.set(
          ballPos.x + Math.cos(angle) * radius,
          ballPos.y + DROP_RAY_HEIGHT,
          ballPos.z + Math.sin(angle) * radius
        );

        raycaster.set(origin, down);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        if (!hit) continue;

        const surface = hit.object.userData?.surface;
        if (!surface || INVALID_DROP_SURFACES.includes(surface)) continue;

        const pinDist = hit.point.distanceTo(pin);
        if (pinDist < ballToPin) continue;              // never closer to the hole
        if (hit.point.distanceTo(prev) > ballToPrev) continue; // stay on the near side

        if (pinDist < bestPinDist) {
          bestPinDist = pinDist;
          best = hit.point.clone();
        }
      }

      // first ring with any valid hit wins (nearest to ball), tie-broken toward pin
      if (best) return best;
    }
    return null;
  }  
}
