import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { BallPhysics } from '@/physics/ballPhysics';
import { BallTrail } from '@/objects/ballTrail';
import { CourseSurfaceProperties } from '@/courses/surfaces';

const FIXED_DT = 1 / 120;

const defaultStats = { apex: 0, lateral: 0, carry: 0, total: 0, roll: 0 };
const defaultOptions = { waitTime: 3000 };

export interface GolfBallEvents {
  shotEnded: (details: { surface?: CourseSurfaceProperties }) => void
}

export class GolfBall extends EventEmitter<GolfBallEvents> {
  radius: number;
  options: { waitTime?: number };
  stats: {
    apex: number;
    lateral: number;
    carry: number;
    total: number;
    roll: number;
  };
  isShotActive: boolean;
  startPoint: THREE.Vector3;
  aimPoint: THREE.Vector3;
  object?: THREE.Object3D;
  trail?: BallTrail;
  physics?: BallPhysics;
  #timeout?: number;
  #scene: THREE.Scene;
  #world: World;
  #rapier: RapierInstance;  
  #accumulator: 0;
  #lastShot?: OpenGolfSim.Shot;

  constructor(scene: THREE.Scene, world: World, R: RapierInstance, options = defaultOptions) {
    super();
    this.options = options || {};
    this.radius = 0.0213;
    this.stats = { ...defaultStats };
    this.#scene = scene;
    this.#world = world;
    this.#rapier = R;
    this.#accumulator = 0;
    this.startPoint = new THREE.Vector3(0, 0, 0);
    this.aimPoint = new THREE.Vector3(0, 0, 0);
    this.isShotActive = false;
  }

  reset(aimPoint: THREE.Vector3, startPoint: THREE.Vector3) {
    if (this.object) {
      // remove existing ball object and physics
      this.#scene.remove(this.object);
    }
    if (this.trail) this.trail.remove();
    if (this.physics) this.physics.remove();
  
    // const geometry = new THREE.SphereGeometry( this.radius, 32, 16 );
    const geometry = new THREE.IcosahedronGeometry(this.radius, 5);
    const material = new THREE.MeshBasicMaterial( { color: 0xffffff } );
    this.object = new THREE.Mesh( geometry, material );
    this.object.castShadow = false;
    this.object.frustumCulled = false;
    if (startPoint) {
      this.startPoint = startPoint;
      this.object.position.copy(startPoint);
      this.object.position.y += this.radius;
    }

    this.#scene.add(this.object);

    if (aimPoint) {
      this.aimAt(aimPoint)
    }

    this.physics = new BallPhysics(this.object, this.#world, this.#rapier, this.radius);
    this.physics.on('shotEnded', surface => this._onShotEnded(surface));
    this.trail = new BallTrail(this.#scene, this.object);
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
    this.isShotActive = false;
    clearTimeout(this.#timeout);
    this.#timeout = setTimeout(() => {
      this.emit('shotEnded', { surface });
      // this.dispatchEvent(new CustomEvent('shotEnd', { detail: { surface } }));
    }, this.options.waitTime);
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

  launchShot(shot: OpenGolfSim.Shot) {
    if (this.isShotActive) {
      return;
    }
    this.isShotActive = true;
    this.#lastShot = shot;
    const isPutt = shot.verticalLaunchAngle < 1;
    this.stats = { ...defaultStats };
    // if (this.physics) {
    //   this.physics.isGrounded = isPutt;
    //   this.physics.isLanded = isPutt;
    // }
    this.#accumulator = 0;
    if (this.trail) {
      // add first point
      this.trail.addPoint();
    }
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