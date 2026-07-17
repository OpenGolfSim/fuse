import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  type World,
  type EventQueue,
} from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { UnitConversions } from '@/utils/units';
import { CourseSurfaceProperties, CourseSurfaces, isCourseSurfaceType, CourseSurfaceType } from '@/courses/surfaces';
import { PhysicsLookupTable, GRAVITY } from './constants';

interface BallPhysicsEvents {
  shotEnded: (surface: CourseSurfaceProperties | undefined) => void;
  holedOut: () => void;
  landed: (velocity: number) => void;
}

type TerrainInfo = {
  height: number,
  restitution: number,
  friction: number,
  normal: THREE.Vector3,
  surface?: CourseSurfaceProperties
}

// Membership in low 16 bits, filter in high 16 bits
export const GROUP_TERRAIN = 0x0001;
export const GROUP_BALL    = 0x0002;
export const GROUP_OBJECT  = 0x0004; // trees, walls, etc.

export class BallPhysics extends EventEmitter<BallPhysicsEvents> {
  mesh: THREE.Object3D;
  world: World;
  rapier: RapierInstance;

  ballRadius: number;
  ballArea: number;
  ballMass = 0.04593;
  airDensity = 1.225;
  airDensityMin = 1.225;
  airDensityMax = 1.0;
  magnusCoeff = 0.00015;
  dragCoeff = 0.25;
  spinDecayRate = 0.987;
  sideSpinDecayRate = 0.95;
  gripStrength = 2.8;
  stimpLevel = 8;   // green speed, feet of rollout from 1.83 m/s release

  // State flags
  isPutt = false;
  isLanded = false;
  isGrounded = false;
  isEnded = false;
  isShotActive = false;
  hasBeenAirborne = false;
  terrainCollisionsEnabled = false;
  currentSurface?: CourseSurfaceProperties;

  // Thresholds
  defaultEndThresholdSpeed = 0.15;   // m/s linear
  defaultEndThresholdAngular = 10.0;  // rad/s
  shotFrames = 0;
  groundedFrames = 0;
  groundedFramesRequired = 10; // consecutive grounded steps before "rolling"

  eventQueue: EventQueue;

  // golf hole physics
  holeCenter = new THREE.Vector2();   // (x, z), set when the pin is placed
  holeRadius = 0.054;                 // 108mm
  cupDepth   = 0.105;                 // ≥101.6mm regulation
  holeGroundY = 0;                    // green Y at the pin, captured on entry
  // holeState: 'none' | 'over' | 'falling' | 'exiting' = 'none';
  holeState: 'none' | 'falling' | 'exiting' = 'none';
  isHoled = false;

  #lastTerrainInfo: TerrainInfo = {
    height: 0,
    restitution: 0.35,
    friction: 0.6,
    normal: new THREE.Vector3(0, 1, 0),
  }
  #mergedBVH!: MeshBVH;
  #mergedMesh!: THREE.Mesh;
  #surfaceKeys: string[] = [];

  #terrainRay = new THREE.Ray();
  #surfaceSpin = new THREE.Vector3();

  #gravity = new THREE.Vector3();
  #slopeForce = new THREE.Vector3();
  #normalClone = new THREE.Vector3();
  #groundNormal = new THREE.Vector3();
  #normalComponent = new THREE.Vector3();
  #tangentComponent = new THREE.Vector3();
  #position = new THREE.Vector3();
  #velocity = new THREE.Vector3();
  #angularVel = new THREE.Vector3();
  #hitNormal = new THREE.Vector3(0, 1, 0);

  constructor(
    mesh: THREE.Object3D,
    world: World,
    rapier: RapierInstance,
    radius = 0.021335,
    terrainMeshes: THREE.Mesh[] = [],
    stimpLevel?: number
  ) {
    super();
    this.mesh = mesh;
    this.world = world;
    this.world.integrationParameters.numSolverIterations = 8;

    if (stimpLevel) {
      this.stimpLevel = stimpLevel;
    }

    this.rapier = rapier;
    
    // Ball constants
    this.ballRadius = radius ?? 0.021335;
    // this.ballMass = 0.04593;
    this.ballArea = Math.PI * this.ballRadius * this.ballRadius;

    // Event queue for collision callbacks
    this.eventQueue = new this.rapier.EventQueue(true);
    
    this.buildTerrainMap(terrainMeshes);
    // Start frozen
    this.freeze();
  }

  reset(position: THREE.Vector3, holePosition?: THREE.Vector3) {
    this.#position.copy(position);
    this.#velocity.set(0, 0, 0);
    this.#angularVel.set(0, 0, 0);
    this.mesh.position.copy(position);

    this.isShotActive = false;
    this.isPutt = false;
    this.isLanded = false;
    this.isGrounded = false;
    this.isEnded = false;
    this.isHoled = false;
    this.hasBeenAirborne = false;
    this.terrainCollisionsEnabled = false;
    this.currentSurface = undefined;
    this.holeState = 'none';
    this.shotFrames = 0;
    this.groundedFrames = 0;
    if (holePosition) this.setPin(holePosition);
  }
  
  buildTerrainMap(terrainMeshes: THREE.Mesh[]) {
    if (terrainMeshes.length > 0) {
      const geometries: THREE.BufferGeometry[] = [];

      for (const tm of terrainMeshes) {
        tm.updateMatrixWorld(true);
        const geo = tm.geometry.clone();
        geo.applyMatrix4(tm.matrixWorld);
        
        const surfaceIndex = this.#surfaceKeys.length;
        this.#surfaceKeys.push(tm.userData.surface ?? 'base');        

        // Store surface index per face via groups
        geo.clearGroups();
        geo.addGroup(0, geo.index ? geo.index.count : geo.attributes.position.count, surfaceIndex);

        geometries.push(geo);
      }

      const merged = mergeGeometries(geometries, true);
      if (merged) {
        this.#mergedBVH = new MeshBVH(merged);
        this.#mergedMesh = new THREE.Mesh(merged);
        this.#mergedMesh.matrixWorld.identity();
      }
    }
  }

  /** Set elevation and air density */
  setElevation(meters = 0) {
    console.log(`Playing with elevation: ${meters}`);
    if (meters === 0) {
      this.airDensity = this.airDensityMin;
      return;
    }
    const t = THREE.MathUtils.clamp(meters, 0, 10000) / 10000;
    this.airDensity = THREE.MathUtils.lerp(this.airDensityMin, this.airDensityMax, t);
  }

  /** Look up physics values by ball speed */
  interpolateBySpeed(speed: number) {
    const table = [...Object.values(PhysicsLookupTable)].sort((a, b) => a.ballSpeed - b.ballSpeed);
    if (speed <= table[0].ballSpeed) return table[0];
    if (speed >= table[table.length - 1].ballSpeed) return table[table.length - 1];

    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i], b = table[i + 1];
      if (speed >= a.ballSpeed && speed < b.ballSpeed) {
        const t = (speed - a.ballSpeed) / (b.ballSpeed - a.ballSpeed);
        const l = THREE.MathUtils.lerp;
        return {
          ballSpeed: speed,
          // spinRate: l(a.spinRate, b.spinRate, t),
          // launchAngle: l(a.launchAngle, b.launchAngle, t),
          magnusCoeff: l(a.magnusCoeff, b.magnusCoeff, t),
          dragCoeff: l(a.dragCoeff, b.dragCoeff, t),
          spinDecayRate: l(a.spinDecayRate, b.spinDecayRate, t),
          sideSpinDecayRate: l(a.sideSpinDecayRate, b.sideSpinDecayRate, t),
        };
      }
    }
    return table[table.length - 1];
  }

  /** Freeze the ball in place, basically stops the physics */
  freeze() {
    // this.rigidBody.setBodyType(this.rapier.RigidBodyType.Fixed, true);
    this.isShotActive = false;
  }

  unfreeze() {
    // this.rigidBody.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
  }

  resetTo(position: THREE.Vector3) {
    this.isShotActive = false;
    this.#position.copy(position);
    this.#velocity.set(0, 0, 0);
    this.#angularVel.set(0, 0, 0);
    
    this.isLanded = false;
    this.isGrounded = false;
    this.isHoled = false;
    this.isEnded = false;
    this.groundedFrames = 0;
  }

  launchShot(shot: OpenGolfSim.Shot, isPutt = false) {
    const ballSpeed = UnitConversions.milesPerHourToMetersPerSecond(shot.ballSpeed);
    
    // clamp spin between 0 and 13,000 RPM
    const spinSpeed = THREE.MathUtils.clamp(shot.spinSpeed, 0, 13_000);
    // clamp spin axis between -45 and +45
    const spinAxis = THREE.MathUtils.clamp(shot.spinAxis, -45, 45);
    // clamp HLA between -45 and +45
    const hla = THREE.MathUtils.clamp(shot.horizontalLaunchAngle, -45, 45);

    // clamp VLA between 0/1 and +50
    const vlaMin = isPutt ? 0 : 1;
    const vla = THREE.MathUtils.clamp(shot.verticalLaunchAngle, vlaMin, 50);

    // Reset state
    this.hasBeenAirborne = false;
    this.terrainCollisionsEnabled = true;
    this.isLanded = isPutt;
    this.isGrounded = isPutt;
    this.isEnded = false;
    this.isPutt = isPutt;
    this.groundedFrames = 0;
    this.shotFrames = 0;

    this.holeState = 'none';

    // Unfreeze
    // this.unfreeze();
    this.isShotActive = true;
    
    if (isPutt) {
      console.log('Launching putt', JSON.stringify({ ballSpeed, hla, spinSpeed }));
      this._launchPutt(ballSpeed, hla, spinSpeed);
    } else {
      console.log('Launching full shot', JSON.stringify({ ballSpeed, vla, hla, spinSpeed, spinAxis }));
      this._launchFull(
        ballSpeed,
        vla,
        hla,
        spinSpeed,
        spinAxis,
      );
    }
  }

  _launchPutt(speed: number, hla: number = 0, spinRPM: number = 0) {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const qH = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(-hla),
    );
    dir.applyQuaternion(qH).normalize().multiplyScalar(speed);

    // Putts skip air phase — initialize ground physics vectors directly
    this.#velocity.copy(dir);
    this.#angularVel.set(0, 0, 0);
    this.#position.copy(this.mesh.position);

    const coeffs = this.interpolateBySpeed(speed);
    this.dragCoeff = coeffs.dragCoeff;
    this.spinDecayRate = coeffs.spinDecayRate;
    this.sideSpinDecayRate = coeffs.sideSpinDecayRate;
  }

  _launchFull(speed: number, vla: number, hla: number = 0, spinRPM: number = 0, spinAxisDeg: number = 0) {
    // Velocity
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion);

    const dir = forward.clone();
    dir.applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(-hla))
    );
    dir.applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(right, THREE.MathUtils.degToRad(-vla))
    );
    dir.normalize().multiplyScalar(speed);

    this.#velocity.copy(dir);

    // Spin
    const spinRad = spinRPM * 2 * Math.PI / 60;
    const axisRad = THREE.MathUtils.degToRad(spinAxisDeg * -1);
    const localLeft = right.clone().multiplyScalar(-1);

    const spinVec = new THREE.Vector3()
      .addScaledVector(localLeft, Math.cos(axisRad))
      .addScaledVector(up, Math.sin(axisRad))
      .multiplyScalar(spinRad);

    this.#angularVel.copy(spinVec);
    this.#surfaceSpin.copy(spinVec);
    this.#position.copy(this.mesh.position);


    // Set coefficients
    const coeffs = this.interpolateBySpeed(speed);
    this.magnusCoeff = coeffs.magnusCoeff;
    this.dragCoeff = coeffs.dragCoeff;
    this.spinDecayRate = coeffs.spinDecayRate;
    this.sideSpinDecayRate = coeffs.sideSpinDecayRate;
  }


  _handleLanding() {
    const vMag = THREE.MathUtils.clamp(this.#velocity.length(), 0, 25) / 25;
    this.emit('landed', vMag);    
  }

  _updateAirPhysics(dt: number) {
    const pos = this.#position;
    const vel = this.#velocity;
    const spin = this.#angularVel;

    const vMag = vel.length();

    // Drag
    if (vMag > 1e-6) {
      const dragFactor = -0.5 * this.dragCoeff * this.airDensity * this.ballArea * vMag / this.ballMass;
      vel.addScaledVector(vel, dragFactor * dt);

      // Magnus
      const magnus = this.#gravity.crossVectors(spin, vel)
        .multiplyScalar(this.magnusCoeff / this.ballMass);
      const maxLift = GRAVITY * 0.83;
      if (magnus.length() > maxLift) magnus.setLength(maxLift);
      vel.addScaledVector(magnus, dt);
    }

    // Gravity
    vel.y -= GRAVITY * dt;

    // Spin decay
    const decayBack = Math.pow(this.spinDecayRate, dt / 0.02);
    const decaySide = Math.pow(this.sideSpinDecayRate, dt / 0.02);
    spin.x *= decayBack;
    spin.z *= decayBack;
    spin.y *= decaySide;

    // Integrate position
    const newX = pos.x + vel.x * dt;
    const newY = pos.y + vel.y * dt;
    const newZ = pos.z + vel.z * dt;

    pos.set(newX, newY, newZ);

    // Track airborne frames
    this.shotFrames++;
    if (!this.hasBeenAirborne && this.shotFrames > 1) {
      const terrainY = this.getTerrainHeight(newX, newZ);
      if (newY > terrainY + this.ballRadius * 3) {
        this.hasBeenAirborne = true;
      }
    }

    // Detect landing
    if (this.hasBeenAirborne) {
      const terrainY = this.getTerrainHeight(newX, newZ);
      if (newY <= terrainY + this.ballRadius + 0.01) {
        this.isLanded = true;
      }
    }

    // Failsafe: a shot that never achieved airborne (mishit/misread scraper)
    // but is sinking below the surface has landed — without this, the
    // airborne gate above lets it integrate straight through the ground.
    if (!this.hasBeenAirborne && this.shotFrames > 2 && vel.y <= 0) {
      const terrainY = this.getTerrainHeight(newX, newZ);
      if (newY <= terrainY + this.ballRadius) {
        this.isLanded = true;
      }
    }

  }  

  // Main update called every frame with a fixed dt
  update(dt: number) {
    if (!this.isShotActive) return;

    if (!this.isLanded) {
      this._updateAirPhysics(dt);
      // Ground-truth spin for landing physics — flight (#angularVel) is untouched
      this.#surfaceSpin.multiplyScalar(Math.pow(0.999, dt / 0.02)); // ~3%/s, realistic

    } else {
      // Use custom ground physics once landed
      this._updateGroundPhysics(dt);
    }

    // Set mesh position once per step from physics state
    this.mesh.position.copy(this.#position);

    // Check if ball has come to rest
    if (this.isGrounded && !this.isEnded) {
      const vel = this.#velocity;
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

      const endThresholdSpeed = this.currentSurface?.stopSpeed ?? this.defaultEndThresholdSpeed;
      if (speed < endThresholdSpeed) {
        this._endShot();
      }
    }
  }

  _endShot() {
    this.isEnded = true;
    this.isShotActive = false;
    this.emit('shotEnded', this.currentSurface);
  }

  _checkWaterCollision() {
    if (
      this.currentSurface?.type === 'plane_lake' ||
      this.currentSurface?.type === 'plane_river'
    ) {
      console.log('Landed in water!');
      return true;
    }
  }

  _updateCupFall(dt: number) {
    const pos = this.#position;
    const vel = this.#velocity;

    vel.y -= GRAVITY * dt;

    let nx = pos.x + vel.x * dt;
    let nz = pos.z + vel.z * dt;
    let ny = pos.y + vel.y * dt;

    // contain within the cup wall (rim radius minus ball radius)
    const C = this.holeCenter;
    const off = new THREE.Vector2(nx - C.x, nz - C.y);
    const maxOff = this.holeRadius - this.ballRadius;
    if (off.length() > maxOff) {
      off.setLength(maxOff);
      nx = C.x + off.x; nz = C.y + off.y;
      // bounce off the wall, damped — this is the rattle
      const n = off.clone().normalize();
      const vh = new THREE.Vector2(vel.x, vel.z);
      vh.addScaledVector(n, -2 * vh.dot(n));
      vh.multiplyScalar(0.4);
      vel.x = vh.x; vel.z = vh.y;
    }

    const bottomY = this.holeGroundY - this.cupDepth + this.ballRadius;
    if (ny <= bottomY) {
      ny = bottomY;
      vel.set(vel.x * 0.3, Math.abs(vel.y) * 0.25, vel.z * 0.3); // small floor bounce
      if (vel.length() < 0.15) {
        pos.set(nx, bottomY, nz);
        vel.set(0, 0, 0);
        // this.mesh.position.copy(pos);
        this.holeState = 'none';
        this.isHoled = true;
        this.emit('holedOut');
        this._endShot();
        return;
      }
    }

    pos.set(nx, ny, nz);
  }


  _updateGroundPhysics(dt: number) {
    // Falling into hole check
    if (this.holeState === 'falling') {
      console.log('Ball is falling into hole');
      this._updateCupFall(dt);
      return;
    }

    const pos = this.#position;
    const vel = this.#velocity;
    // separate spin calculation for ground/roll
    const spin = this.#surfaceSpin;

    // Apply gravity
    vel.y -= GRAVITY * dt;

    // Calculate new ball position
    const newX = pos.x + vel.x * dt;
    const newZ = pos.z + vel.z * dt;
    const newY = pos.y + vel.y * dt;

    const terrain = this.getTerrainInfo(newX, newZ);
    const terrainY = terrain.height;
    const normal = this.#groundNormal.copy(terrain.normal);
    // Note: Make sure ground always faces up to guard against flipped winding
    if (normal.y < 0) normal.negate();

    if (this.holeState !== 'exiting' && this._checkHole(pos, newX, newZ, vel, terrainY)) {
      // Advance to closest approach point, not the endpoint (which may be past the hole)
      const segX = newX - pos.x;
      const segZ = newZ - pos.z;
      const segLenSq = segX * segX + segZ * segZ;
      if (segLenSq > 1e-12) {
        const C = this.holeCenter;
        const t = THREE.MathUtils.clamp(
          ((C.x - pos.x) * segX + (C.y - pos.z) * segZ) / segLenSq, 0, 1
        );
        pos.x += segX * t;
        pos.z += segZ * t;
        // Keep ball Y at terrain height
        pos.y = terrainY + this.ballRadius;
      }
      return;
    }

    if (this._checkWaterCollision()) {
      this.mesh.visible = false;
      this._endShot();
      return;
    }
    
    this.currentSurface = terrain?.surface;

    const minY = terrainY + (this.ballRadius * 2);

    if (newY <= minY && this.holeState !== 'exiting') {
      // Handle bounce and roll
      const speed = vel.length();
      const impactVelAlongNormal = -vel.dot(normal);

      if (impactVelAlongNormal > 0.5) {
        const descentAngle = Math.abs(vel.y) / speed;

        const restitutionRaw = this.currentSurface?.restitution ?? 0.25;
        // Steep descent means more energy is absorbed by the turf
        const descentRestitution = THREE.MathUtils.lerp(1.0, 0.8, descentAngle);

        // Divot/crater absorption: fast AND steep impacts deform the turf,
        // eating energy beyond what angle alone predicts
        const divot = this.currentSurface?.divot ?? 0;
        const craterLoss = 1 / (1 + divot * impactVelAlongNormal * descentAngle);
        const restitution = restitutionRaw * descentRestitution * craterLoss;
        const tangentRetention = THREE.MathUtils.lerp(0.92, 0.75, descentAngle) * THREE.MathUtils.lerp(1.0, craterLoss, 0.6);

        vel.reflect(normal);

        const normalComponent = this.#normalComponent.copy(vel).projectOnVector(normal);
        const tangentComponent = this.#tangentComponent.copy(vel).sub(normalComponent);

        vel.copy(tangentComponent.multiplyScalar(tangentRetention)).add(normalComponent.multiplyScalar(restitution));

        this._handleLanding();

        // Spin-friction impulse (check-up / spin-back)
        const spinMag = spin.length();
        if (spinMag > 1.0) {
          // Ball-surface velocity at contact: ω × (-R·n̂)
          const contact = this.#normalClone.copy(normal).multiplyScalar(-this.ballRadius);
          const spinSurfaceVel = new THREE.Vector3().crossVectors(spin, contact);
          // Turf bite ramps with spin: ~rigid physics below 1500 RPM,
          // full surface spinGrip by ~6500 RPM, smooth in between
          const rpm = spinMag * 9.549; // rad/s → RPM
          const bite = THREE.MathUtils.smoothstep(rpm, 1500, 6500);
          const grip = THREE.MathUtils.lerp(1.0, this.currentSurface?.spinGrip ?? 1.0, bite);
          spinSurfaceVel.multiplyScalar(grip);

          // Slip of ball surface relative to ground, in the surface plane
          const slip = tangentComponent.clone().add(spinSurfaceVel);
          slip.addScaledVector(normal, -slip.dot(normal));

          // Turf brakes; it never shoves the ball forward (kills the over-spin refund)
          if (slip.dot(tangentComponent) < 0) {
            slip.set(0, 0, 0);
          }
          
          const slipSpeed = slip.length();
          if (slipSpeed > 0.05) {
            const mu = this.currentSurface?.friction ?? 0.4;
            // Friction impulse vs normal impulse; capped so it can't overshoot the slip
            const maxImpulse = mu * (1 + restitution) * impactVelAlongNormal;
            // impulse that reaches pure rolling
            const gripImpulse = slipSpeed / 3.5;
            const impulse = Math.min(maxImpulse, gripImpulse);

            slip.divideScalar(slipSpeed); // normalize
            vel.addScaledVector(slip, -impulse);

            // Spin converges toward rolling by the fraction of grip achieved
            const f = impulse / gripImpulse;
            const vtAfter = new THREE.Vector3().copy(vel).addScaledVector(normal, -vel.dot(normal));
            const rollSpin = new THREE.Vector3().crossVectors(normal, vtAfter).divideScalar(this.ballRadius);
            spin.lerp(rollSpin, f);
          }
        }
        
        // Update final ball position
        pos.set(newX, terrainY + this.ballRadius, newZ);

      } else {
        // Handle rolling
        this.isGrounded = true;

        // Project velocity onto surface plane
        vel.sub(this.#normalClone.copy(normal).multiplyScalar(vel.dot(normal)));

        // Rolling resistance
        let resistance = this.currentSurface?.rollResistance ?? CourseSurfaces.base.rollResistance;
        // const horizontalSpeedThreshold = this.currentSurface?.rollResistanceSpeedThreshold ?? CourseSurfaces.base.rollResistanceSpeedThreshold;
        const horizontalSpeed = vel.length();
        const normalForce = normal.y; // cos(θ): 1.0 on flat, less on slopes
        // const friction = Math.min(resistance * GRAVITY * normalForce * dt, horizontalSpeed);
        // Stimp-driven roll on the green: Stimpmeter releases at 1.83 m/s,
        // rating = rollout in feet, so constant decel a = 5.49 / stimp
        const useStimpLevel = this.currentSurface?.type === CourseSurfaceType.Green;
        const decel = useStimpLevel
          ? 5.49 / this.stimpLevel
          : resistance * GRAVITY;
        const friction = Math.min(decel * normalForce * dt, horizontalSpeed);


        vel.addScaledVector(this.#normalClone.copy(vel).normalize(), -friction);

        if (!useStimpLevel) {
          const dampingFactor = Math.exp(-resistance * 8.0 * normalForce * dt);
          vel.multiplyScalar(dampingFactor);
        }          
        // Hard cutoff — anything below this is just numerical noise
        if (vel.length() < 0.02) {
          vel.set(0, 0, 0);
        }

        // Spin deflection during roll — ω × r gives surface velocity at contact
        if (spin.length() > 1.0 && horizontalSpeed > 0.1) {
          // Friction acts on contact-point slip, not raw spin so a rolling ball has zero slip and feels zero force (no runaway)
          const contactPoint = this.#normalClone.copy(normal).multiplyScalar(-this.ballRadius);
          const slipVel = this.#slopeForce.crossVectors(spin, contactPoint).add(vel);
          slipVel.addScaledVector(normal, -slipVel.dot(normal));
          const slipLen = slipVel.length();

          if (slipLen > 0.02) {
            const mu = this.currentSurface?.friction ?? 0.4;
            // Friction decel, capped so it can't overshoot rolling this frame
            const dv = Math.min(mu * GRAVITY * Math.max(normal.y, 0) * dt, slipLen / 3.5);
            slipVel.divideScalar(slipLen);
            vel.addScaledVector(slipVel, -dv);

            // Spin converges toward rolling by the same fraction
            const f = dv / (slipLen / 3.5);
            const rollSpin = new THREE.Vector3().crossVectors(normal, vel).divideScalar(this.ballRadius);
            spin.lerp(rollSpin, f);
          }

        }

        pos.set(newX, terrainY + this.ballRadius, newZ);
        vel.y = 0;
      }
    } else {
      // Airborne between bounces
      this.isGrounded = false;
      this.currentSurface = undefined;
      pos.set(newX, newY, newZ);
      if (this.holeState === 'exiting') {
        this.holeState = 'none';
      }
    }

    // Final check for lowest ground point (don't let the ball fall through)
    const checkY = this.getTerrainHeight(pos.x, pos.z);
    const safeY = (checkY + this.ballRadius);

    if (pos.y < safeY - 0.005) {
      console.warn('Ball fallen below ground');
      pos.y = safeY;
      if (vel.y < 0) vel.y = 0;
    }
  }

  getTerrainInfo(x: number, z: number) {
    if (!this.#mergedBVH) {
      return this.#lastTerrainInfo;
    }

    this.#terrainRay.origin.set(x, 1000, z);
    this.#terrainRay.direction.set(0, -1, 0);

    const hit = this.#mergedBVH.raycastFirst(this.#terrainRay, THREE.DoubleSide);
    if (!hit) {
      console.warn('[terrain] raycast MISS at', x.toFixed(1), z.toFixed(1));
      return this.#lastTerrainInfo;
    }

    let surfaceKey = 'base';
    if (hit.faceIndex != null && this.#mergedMesh.geometry.groups.length > 0) {
      const vertIndex = hit.faceIndex * 3;
      for (const group of this.#mergedMesh.geometry.groups) {
        if (vertIndex >= group.start && vertIndex < group.start + group.count) {
          surfaceKey = this.#surfaceKeys[group.materialIndex ?? 0];
          break;
        }
      }
    }

    const validSurfaceKey = isCourseSurfaceType(surfaceKey) ? surfaceKey : CourseSurfaceType.Base;
    const surfaceSettings = CourseSurfaces[validSurfaceKey];

    const normal = hit.face
      ? this.#hitNormal.copy(hit.face.normal)
      : this.#hitNormal.set(0, 1, 0);

    this.#lastTerrainInfo = {
      height: hit.point.y,
      restitution: surfaceSettings.restitution ?? 0.35,
      friction: surfaceSettings.friction ?? 0.6,
      surface: { type: validSurfaceKey, ...surfaceSettings },
      normal
    };
    return this.#lastTerrainInfo;
  }
  
  getTerrainHeight(x: number, z: number) {
    return this.getTerrainInfo(x, z).height;
  }

  _getTerrainNormal(x: number, z: number) {
    const eps = 0.1;
    const hL = this.getTerrainHeight(x - eps, z);
    const hR = this.getTerrainHeight(x + eps, z);
    const hD = this.getTerrainHeight(x, z - eps);
    const hU = this.getTerrainHeight(x, z + eps);
    return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
  }

  setPin(pin: THREE.Vector3) {
    this.holeCenter.set(pin.x, pin.z);
    this.holeGroundY = pin.y;   // green Y at the pin
    console.log(`Setting hole center to: ${pin.toArray().join(',')}`)
  }
  
  _checkHole(pos: THREE.Vector3, newX: number, newZ: number, vel: THREE.Vector3, terrainY: number): boolean {
    const R = this.holeRadius;
    const r = this.ballRadius;
    const C = this.holeCenter;

    // Larger detection zone — 3x hole radius gives us early warning
    const detectionRadius = R * 3;

    // Path segment
    const dx = newX - pos.x;
    const dz = newZ - pos.z;
    const segLenSq = dx * dx + dz * dz;
    if (segLenSq < 1e-12) return false;

    // Closest approach of path to hole center
    const fx = pos.x - C.x;
    const fz = pos.z - C.y;
    const tClosest = THREE.MathUtils.clamp(-(fx * dx + fz * dz) / segLenSq, 0, 1);
    const closestX = pos.x + dx * tClosest;
    const closestZ = pos.z + dz * tClosest;
    const closestDist = Math.hypot(closestX - C.x, closestZ - C.y);

    // Not even close
    if (closestDist >= detectionRadius) return false;

    const vh = Math.hypot(vel.x, vel.z);

    // Ball doesn't actually reach the hole rim — just passing nearby
    if (closestDist >= R + r) {
      // Gentle pull when passing close but not crossing
      if (closestDist < R * 2 && vh < 3.0) {
        const pullFactor = 1 - (closestDist / (R * 2));
        const toCenterX = C.x - newX;
        const toCenterZ = C.y - newZ;
        const toCenterDist = Math.hypot(toCenterX, toCenterZ);
        if (toCenterDist > 0.001) {
          const gentlePull = pullFactor * 0.02;
          vel.x += (toCenterX / toCenterDist) * gentlePull;
          vel.z += (toCenterZ / toCenterDist) * gentlePull;
        }
      }
      return false;
    }

    // === Ball path crosses the hole (closestDist < R + r) ===

    // How centrally does the path cross? 1 = dead center, 0 = rim edge
    const centrality = Math.max(0, 1 - closestDist / (R + r));


    // Fall-in speed threshold — linear scale with centrality
    // Dead center: up to ~7 mph (3.0 m/s) drops in
    // Half off-center: up to ~4.5 mph (2.0 m/s)
    // Rim edge: up to ~2 mph (1.0 m/s)
    const fallInSpeed = 1.0 + centrality * 2.5;

    if (vh < fallInSpeed) {
      this._enterCup(terrainY);
      return true;
    }

    // When the ball crosses too fast to drop, we compute a lip-out
    // How long the ball spends over the hole determines lip impact
    // Fast ball = short crossing time = barely affected
    const chord = 2 * Math.sqrt(Math.max(0, (R + r) * (R + r) - closestDist * closestDist));
    const crossingTime = chord / vh;
    // How much the ball dips during crossing (gravity drop)
    const gravityDrop = 0.5 * GRAVITY * crossingTime * crossingTime;
    // Normalized: 0 = barely dipped, 1 = dropped a full ball radius
    const dipFactor = Math.min(gravityDrop / r, 1.0);

    // Find the exit point on the rim circle
    const a = segLenSq;
    const b2 = fx * dx + fz * dz; // half of b
    const c = fx * fx + fz * fz - (R + r) * (R + r);
    const discriminant = b2 * b2 - a * c;

    let exitX = newX, exitZ = newZ;
    if (discriminant >= 0 && a > 1e-12) {
      const tExit = (-b2 + Math.sqrt(discriminant)) / a;
      if (tExit >= 0 && tExit <= 1) {
        exitX = pos.x + dx * tExit;
        exitZ = pos.z + dz * tExit;
      }
    }

    // Place ball at the exit point
    const exitTerrain = this.getTerrainInfo(exitX, exitZ);
    pos.set(exitX, exitTerrain.height + this.ballRadius, exitZ);

    // Very fast ball barely dips — skip interaction entirely
    if (dipFactor < 0.05) {
      return false;
    }

    // Speed loss scales with dip — fast ball loses almost nothing
    const speedRetain = 1.0 - dipFactor * centrality * 0.2;
    vel.x *= speedRetain;
    vel.z *= speedRetain;

    // Lip bounce scales with dip factor — fast ball gets no bounce
    const exitSpeed = Math.hypot(vel.x, vel.z);
    const lipBounceFromSpeed = exitSpeed * 0.4 * dipFactor;
    const lipBounceFromDepth = centrality * 0.6 * dipFactor;
    const minimumLipBounce = 0.2 * dipFactor;
    const maximumLipBounce = 2.0;
    vel.y = Math.min(lipBounceFromSpeed + lipBounceFromDepth + minimumLipBounce, maximumLipBounce);

    // Deflection away from hole center — stronger with off-center crossings
    // Off-center balls get pushed sideways, center crossings go mostly up
    const awayX = exitX - C.x;
    const awayZ = exitZ - C.y;
    const awayDist = Math.hypot(awayX, awayZ);
    if (awayDist > 0.001) {
      // Tangent to the rim circle — curves ball around the hole, not away from it
      const radialX = awayX / awayDist;
      const radialZ = awayZ / awayDist;

      // Perpendicular to radial, matching ball's travel direction
      let tangentX = -radialZ;
      let tangentZ = radialX;
      if (tangentX * vel.x + tangentZ * vel.z < 0) {
        tangentX = -tangentX;
        tangentZ = -tangentZ;
      }

      // Blend velocity toward tangential — more for off-center crossings
      const offCenter = 1.0 - centrality;

      // Only apply rim deflection for genuinely off-center crossings
      // Center crossings just bounce straight up
      const rimCurveStrength = offCenter * offCenter * 1.0;
      const deflectAmount = dipFactor * rimCurveStrength;

      if (deflectAmount > 0.01) {
        vel.x += tangentX * vh * deflectAmount;
        vel.z += tangentZ * vh * deflectAmount;
      }

      // Re-normalize to original speed (always, regardless of deflection)
      const newSpeed = Math.hypot(vel.x, vel.z);
      if (newSpeed > 0.001) {
        const targetSpeed = vh * speedRetain;
        vel.x *= targetSpeed / newSpeed;
        vel.z *= targetSpeed / newSpeed;
      }

    }

    this.holeState = 'exiting';
    this.isGrounded = false;
    return true;
  }

  _enterCup(terrainY: number) {
    this.holeState = 'falling';
    this.holeGroundY = terrainY;
    this.isGrounded = false; // stop the rest-check from ending the shot mid-drop
  }

}