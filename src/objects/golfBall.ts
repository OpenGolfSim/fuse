import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { BallPhysics } from '@/physics/ballPhysics';
import { BallTrail } from '@/objects/ballTrail';
import { CourseColliderType, CourseSurfaceProperties, CourseSurfaceType } from '@/courses/surfaces';

const FIXED_DT = 1 / 120;

export interface GolfBallEvents {
  shotEnded: (details: { surface?: CourseSurfaceProperties }) => void
}

type BallTrailClearMode = 'start' | 'end' | 'never';

type GolfBallOptions = {
  waitTime?: number;
  setupData?: Partial<OpenGolfSim.SetupData>;
  /** Clear ball trail before the shot. Default is to clear when the shot ends. */
  clearTrail?: BallTrailClearMode;
}

export type ShotStats = {
  apex: number;
  lateral: number;
  carry: number;
  total: number;
  roll: number;
  surface: CourseColliderType;
  startPosition?: THREE.Vector3;
  landPosition?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  heightSamples: number[];
  distanceSamples: number[];
  lateralSamples: number[];
}

const createDefaultStats = (): ShotStats => ({
  apex: 0, lateral: 0, carry: 0, total: 0, roll: 0,
  surface: CourseSurfaceType.Base,
  heightSamples: [],
  distanceSamples: [],
  lateralSamples: [],
});

export class GolfBall extends EventEmitter<GolfBallEvents> {
  radius: number;
  stats: ShotStats;
  isShotActive: boolean;
  isShotWaiting: boolean;
  startPoint: THREE.Vector3;
  aimPoint: THREE.Vector3;
  object?: THREE.Object3D;
  trail?: BallTrail;
  physics?: BallPhysics;
  clearTrail: BallTrailClearMode;
  #setupData?: Partial<OpenGolfSim.SetupData>;
  #waitTime: number;
  #timeout?: number;
  #scene: THREE.Scene;
  #world: World;
  #rapier: RapierInstance;  
  #accumulator: 0;
  #frameNum: 0;
  lastShot?: OpenGolfSim.Shot;
  ballMaterial: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene, world: World, R: RapierInstance, options: GolfBallOptions = {}) {
    super();
    this.radius = 0.0213;
    this.stats = createDefaultStats();
    this.clearTrail = options.clearTrail || 'end';
    this.#setupData = options.setupData;
    this.#waitTime = options.waitTime ?? 3000;
    this.#scene = scene;
    this.#world = world;
    this.#rapier = R;
    this.#accumulator = 0;
    this.#frameNum = 0;
    this.startPoint = new THREE.Vector3(0, 0, 0);
    this.aimPoint = new THREE.Vector3(0, 0, 0);
    this.isShotActive = false;
    this.isShotWaiting = false;

    this.ballMaterial = new THREE.MeshBasicMaterial( { color: 0xffffff } );

  }

  reset(aimPoint: THREE.Vector3, startPoint: THREE.Vector3) {
    if (this.object) {
      // remove existing ball object and physics
      this.#scene.remove(this.object);
      if (this.object instanceof THREE.Mesh) {
        this.object.geometry.dispose();
        // if (this.object.material) {
        //   (this.object.material as THREE.Material).dispose();
        // }
      }
    }
    if (this.physics) {
      this.physics.removeAllListeners(); // clean up old event listener
      this.physics.remove();
    }
    this.isShotWaiting = false;
    // const geometry = new THREE.SphereGeometry( this.radius, 32, 16 );
    const geometry = new THREE.IcosahedronGeometry(this.radius, 5);
    // const material = new THREE.MeshBasicMaterial( { color: 0xffffff } );
    this.object = new THREE.Mesh( geometry, this.ballMaterial );
    this.object.castShadow = false;
    this.object.frustumCulled = false;
    if (startPoint) {
      this.startPoint = startPoint;
      this.object.position.copy(startPoint);
      this.object.position.y += this.radius;
    }

    this.#scene.add(this.object);

    if (this.clearTrail === 'end') {
      this.#resetBallTrail();
    }
    
    if (aimPoint) {
      this.aimAt(aimPoint)
    }
    
    this.#frameNum = 0;

    this.physics = new BallPhysics(this.object, this.#world, this.#rapier, this.radius);
    this.physics.on('shotEnded', surface => this._onShotEnded(surface));
    this.physics.setElevation(this.#setupData?.elevation);
  }

  #resetBallTrail() {
    if (!this.object) {
      console.warn('No ball object to add trail to');
      return;
    }
    if (this.trail) {
      this.trail.reset(this.object);  // reuse existing instance
    } else {
      this.trail = new BallTrail(this.#scene, this.object, { lineWidth: 0.2 });
    }
  }

  getPosition() {
    if (this.physics?.rigidBody) {
      return this.physics.rigidBody.translation();
    }
  }
  
  isOnGreen() {
    return this.physics?.isGrounded && this.physics?.currentSurface?.type === 'green';
  }

  // aimAt(aimPoint) {
  // const dir = new THREE.Vector3().subVectors(aimPoint, ball.position);
  // dir.y = 0;
  // dir.normalize();
  // ball.rotation.set(0, Math.atan2(dir.x, dir.z), 0);    
  // }

  _onShotEnded(surface: CourseSurfaceProperties | undefined) {
    console.log('RAW SHOT END');
    if (!this.stats.endPosition) {
      this.stats.endPosition = this.object?.position.clone();
    }
    if (surface?.type) {
      this.stats.surface = surface.type;
    }

    clearTimeout(this.#timeout);
    this.#timeout = setTimeout(() => {
      this.isShotActive = false;
      // this.isShotEnded = true;
      console.log('FIRE SHOT END');
      this.emit('shotEnded', { surface });
      // this.dispatchEvent(new CustomEvent('shotEnd', { detail: { surface } }));
    }, this.#waitTime);
  }

  aimAt(aimPoint: THREE.Vector3) {
    this.aimPoint = aimPoint;
    if (!this.object) {
      console.error('No ball object created yet');
      return;
    }
    const direction = new THREE.Vector3().subVectors(aimPoint, this.object.position);
    direction.y = 0; // flatten to horizontal — we only want the yaw
    direction.normalize();
    // 2. Extract yaw angle from that direction
    const yaw = Math.atan2(direction.x, direction.z);
    // 3. Set a clean rotation — only yaw, no pitch/roll
    this.object.rotation.set(0, yaw, 0);  
  }

  getTrailPoints() {
    return this.trail?.points.map(point => point.toArray())
  }

  launchShot(shot: OpenGolfSim.Shot) {
    if (this.isShotActive) {
      return;
    }
    if (this.clearTrail === 'start') {
      this.#resetBallTrail();
    }
    this.isShotActive = true;
    this.lastShot = shot;
    const isPutt = shot.verticalLaunchAngle < 1;
    this.stats = createDefaultStats();

    this.#accumulator = 0;
    if (this.trail) {
      // add first point
      this.trail.addPoint();
    }
    this.stats.startPosition = this.object?.position.clone();

    if (this.physics) {
      this.physics.launchShot(shot, isPutt);
    }
  }


  update(delta: number) {
    const frameDelta = Math.min(delta, 0.1);
    this.#accumulator += frameDelta;

    if (this.physics) {
      // Fixed-timestep physics
      while (this.#accumulator >= FIXED_DT) {
        this.physics.update(FIXED_DT);
        this.#accumulator -= FIXED_DT;
      }
    }
    if (this.trail) {
      this.trail.update(this.isShotActive);
    }

    if (this.isShotActive && this.object) {
      const height = this.object.position.y - this.startPoint.y;

      if (this.object.position.y > this.stats.apex) {
        this.stats.apex = this.object.position.y;
      }
      this.stats.total = this.startPoint.distanceTo(this.object.position);

      if (!this.physics?.isLanded) {
        this.stats.carry = this.stats.total;
      } else {
        this.stats.roll = this.stats.total - this.stats.carry;
      }
      this.stats.lateral = this.getLateralDistance(this.startPoint, this.aimPoint, this.object.position);

      if (this.physics?.isLanded && !this.stats.landPosition) {
        this.stats.landPosition = this.object.position.clone();
      }

      if (this.#frameNum % 4 === 0) {
        this.stats.heightSamples.push(this.object.position.y);
        this.stats.lateralSamples.push(this.stats.lateral);
        this.stats.distanceSamples.push(this.stats.total);
      }
      this.#frameNum++;
    }
  }
  
  getLateralDistance(startPoint: THREE.Vector3, aimPoint: THREE.Vector3, ballPosition: THREE.Vector3) {
    // Direction vector from start to aim (XZ plane only)
    const lineDir = new THREE.Vector2(
      aimPoint.x - startPoint.x,
      aimPoint.z - startPoint.z
    ).normalize();

    // Vector from start to ball (XZ plane)
    const toBall = new THREE.Vector2(
      ballPosition.x - startPoint.x,
      ballPosition.z - startPoint.z
    );

    // 2D cross product gives signed perpendicular distance
    // Positive = right of the line, Negative = left
    const lateralDistance = lineDir.x * toBall.y - lineDir.y * toBall.x;

    return lateralDistance;
  }

}