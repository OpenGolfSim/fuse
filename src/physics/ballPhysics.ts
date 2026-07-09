import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  type World,
  type EventQueue,
  type RigidBody,
  type Vector
} from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { UnitConversions } from '@/utils/units';
import { CourseSurfaceProperties, CourseObjectType, CourseSurfaces, isCourseSurfaceType, CourseSurfaceType } from '@/courses/surfaces';
import { PhysicsLookupTable, GRAVITY, isColliderWithUserData, ColliderWithUserData } from './constants';
import { app } from '../index';

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
  rigidBody: RigidBody;
  collider: ColliderWithUserData;
  ballColliderHandle: number;

  // golf hole physics
  holeCenter = new THREE.Vector2();   // (x, z), set when the pin is placed
  holeRadius = 0.054;                 // 108mm
  cupDepth   = 0.105;                 // ≥101.6mm regulation
  holeGroundY = 0;                    // green Y at the pin, captured on entry
  // holeState: 'none' | 'over' | 'falling' | 'exiting' = 'none';
  holeState: 'none' | 'falling' | 'exiting' = 'none';
  isHoled = false;

  #preStepLinvel?: { x: number; y: number; z: number };

  #lastTerrainInfo: TerrainInfo = {
    height: 0,
    restitution: 0.35,
    friction: 0.6,
    normal: new THREE.Vector3(0, 1, 0),
  }
  // #terrainBVHs: { bvh: MeshBVH, mesh: THREE.Mesh }[] = [];
  #mergedBVH!: MeshBVH;
  #mergedMesh!: THREE.Mesh;
  // #surfaceMap: CourseSurfaceProperties[] = [];
  #surfaceKeys: string[] = [];

  #terrainRay = new THREE.Ray();
  #invMatrix = new THREE.Matrix4();
  #rayOrigin = new THREE.Vector3();
  #rayDirection = new THREE.Vector3(0, -1, 0);
  #vel = new THREE.Vector3();
  #spin = new THREE.Vector3();
  #gravity = new THREE.Vector3();
  #slopeForce = new THREE.Vector3();
  #normalClone = new THREE.Vector3();
  #magnusVec = new THREE.Vector3();
  #normalComponent = new THREE.Vector3();
  #tangentComponent = new THREE.Vector3();
  #position = new THREE.Vector3();
  #velocity = new THREE.Vector3();
  #angularVel = new THREE.Vector3();
  #hitNormal = new THREE.Vector3(0, 1, 0);
  #p0 = new THREE.Vector2();
  #p1 = new THREE.Vector2();
  #seg = new THREE.Vector2();
  #holeTemp = new THREE.Vector2();

  constructor(
    mesh: THREE.Object3D,
    world: World,
    rapier: RapierInstance,
    radius = 0.021335,
    terrainMeshes: THREE.Mesh[] = []
  ) {
    super();
    this.mesh = mesh;
    this.world = world;
    this.world.integrationParameters.numSolverIterations = 8;
    // this.world.integrationParameters.numAdditionalFrictionIterations = 4;

    this.rapier = rapier;
    // this.onShotEnded = onShotEnded;

    // Ball constants
    this.ballRadius = radius ?? 0.021335;
    // this.ballMass = 0.04593;
    this.ballArea = Math.PI * this.ballRadius * this.ballRadius;

    // Event queue for collision callbacks
    this.eventQueue = new this.rapier.EventQueue(true);

    // ── Create Rapier rigid body ──
    const pos = mesh.position;
    const bodyDesc = this.rapier.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0)
      .setAngularDamping(0)
      .setCcdEnabled(true);              // continuous collision detection
    this.rigidBody = world.createRigidBody(bodyDesc);

    // ── Collider (sphere) ──
    const colliderDesc = this.rapier.ColliderDesc.ball(this.ballRadius)
      .setMass(this.ballMass)
      .setRestitution(0.0)
      .setRestitutionCombineRule(this.rapier.CoefficientCombineRule.Min)
      .setFriction(0.6)
      .setActiveEvents(this.rapier.ActiveEvents.COLLISION_EVENTS);
    this.collider = world.createCollider(colliderDesc, this.rigidBody);
    // this.collider.setCollisionGroups(
    //   (GROUP_BALL << 16) | (GROUP_TERRAIN | GROUP_OBJECT)
    // );
    this.collider.setCollisionGroups(
      (GROUP_BALL << 16) | GROUP_OBJECT  // trees/objects only, never terrain
    );

    // Store the collider handle so we can identify it in events
    this.ballColliderHandle = this.collider.handle;
    
    // Build BVH for each terrain mesh
    // for (const tm of terrainMeshes) {
    //   tm.updateMatrixWorld(true);
    //   this.#terrainBVHs.push({ bvh: new MeshBVH(tm.geometry), mesh: tm });
    // }
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

        // Tag every triangle with a surface index
        const triCount = geo.index
          ? geo.index.count / 3
          : geo.attributes.position.count / 3;
        // const surfaceIndex = this.#surfaceMap.length;
        // this.#surfaceMap.push(tm.userData as CourseSurfaceProperties);
        
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
    this.rigidBody.setBodyType(this.rapier.RigidBodyType.Fixed, true);
    this.isShotActive = false;
  }

  unfreeze() {
    this.rigidBody.setBodyType(this.rapier.RigidBodyType.Dynamic, true);
  }

  resetTo(position: THREE.Vector3) {
    // this.freeze();
    // this.rigidBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    // this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    // this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // this.rigidBody.resetForces(true);
    // this.rigidBody.resetTorques(true);
    // // Also clear any internal state flags you keep (collision-entered, etc.)
    // this.rigidBody.wakeUp();
    this.isShotActive = false;
    this.#position.copy(position);
    this.#velocity.set(0, 0, 0);
    this.#angularVel.set(0, 0, 0);
    // this.mesh.position.copy(position);
    
    this.isLanded = false;
    this.isGrounded = false;
    this.isHoled = false;
    this.isEnded = false;
    this.groundedFrames = 0;
    // this.syncMesh();
  }
  
  remove() {
    this.world.removeRigidBody(this.rigidBody);
    // this.world.removeCollider(this.groundCollider, wakeUp);
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
    // Disable CCD during launch — re-enable once airborne
    // this.rigidBody.enableCcd(false);
    
    if (isPutt) {
      this._launchPutt(ballSpeed, hla, spinSpeed);
    } else {
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
    
    // this.rigidBody.setLinvel({ x: dir.x, y: dir.y, z: dir.z }, true);

    // // Spin
    // const spinRad = spinRPM * 2 * Math.PI / 60;
    // console.log('APPLY SPIN', spinRad);
    // // const axisRad = THREE.MathUtils.degToRad(spinAxisDeg * -1);
    // // const localLeft = right.clone().multiplyScalar(-1);

    // const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion);
    // const spinVec = new THREE.Vector3()
    //   // .addScaledVector(localLeft, Math.cos(axisRad))
    //   .addScaledVector(up, 1)
    //   .multiplyScalar(spinRad);

    // this.rigidBody.setAngvel({ x: spinVec.x, y: spinVec.y, z: spinVec.z }, true);
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

    // this.rigidBody.setLinvel({ x: dir.x, y: dir.y, z: dir.z }, true);
    this.#velocity.copy(dir);

    // Spin
    const spinRad = spinRPM * 2 * Math.PI / 60;
    const axisRad = THREE.MathUtils.degToRad(spinAxisDeg * -1);
    const localLeft = right.clone().multiplyScalar(-1);

    const spinVec = new THREE.Vector3()
      .addScaledVector(localLeft, Math.cos(axisRad))
      .addScaledVector(up, Math.sin(axisRad))
      .multiplyScalar(spinRad);

    // this.rigidBody.setAngvel({ x: spinVec.x, y: spinVec.y, z: spinVec.z }, true);
    this.#angularVel.copy(spinVec);
    this.#position.copy(this.mesh.position);


    // Set coefficients
    const coeffs = this.interpolateBySpeed(speed);
    this.magnusCoeff = coeffs.magnusCoeff;
    this.dragCoeff = coeffs.dragCoeff;
    this.spinDecayRate = coeffs.spinDecayRate;
    this.sideSpinDecayRate = coeffs.sideSpinDecayRate;
  }

  _applyAirForces(dt: number) {
    const lv = this.rigidBody.linvel();
    const av = this.rigidBody.angvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const spin = new THREE.Vector3(av.x, av.y, av.z);
    const vMag = vel.length();
    if (vMag < 1e-6) return;

    // Drag: apply as direct velocity change (like the original)
    const dragAccel = vel.clone().multiplyScalar(
      -0.5 * this.dragCoeff * this.airDensity * this.ballArea * vMag / this.ballMass
    );
    vel.addScaledVector(dragAccel, dt);

    // Magnus (only while airborne)
    if (!this.isLanded) {
      const magnus = new THREE.Vector3().crossVectors(spin, vel)
        .multiplyScalar(this.magnusCoeff / this.ballMass);
      const maxLiftAccel = GRAVITY * 0.83;
      if (magnus.length() > maxLiftAccel) magnus.setLength(maxLiftAccel);
      vel.addScaledVector(magnus, dt);
    }

    // Write velocity back — Rapier's step will then handle collisions
    this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);

    // Spin decay
    const decayBack = Math.pow(this.spinDecayRate, dt / 0.02);
    const decaySide = Math.pow(this.sideSpinDecayRate, dt / 0.02);

    spin.x *= decayBack;
    spin.z *= decayBack;
    spin.y *= decaySide;

    this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
  }

  _handleLanding() {
    // const lv = this.rigidBody.linvel();
    // const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    // const vMag = THREE.MathUtils.clamp(vel.length(), 0, 25) / 25;
    const vMag = THREE.MathUtils.clamp(this.#velocity.length(), 0, 25) / 25;
    this.emit('landed', vMag);    
  }

  _processCollisions() {
    this.shotFrames++;

    // Track airborne: ball must rise above launch surface
    if (!this.hasBeenAirborne && this.shotFrames > 1) {
      const pos = this.rigidBody.translation();
      const terrainY = this.getTerrainHeight(pos.x, pos.z);
      if (pos.y > terrainY + this.ballRadius * 3) {
        this.hasBeenAirborne = true;
      }
    }

    // Detect landing via terrain height, not Rapier contacts
    if (this.hasBeenAirborne) {
      const pos = this.rigidBody.translation();
      const terrainY = this.getTerrainHeight(pos.x, pos.z);
      if (pos.y <= terrainY + this.ballRadius + 0.01) {
        if (!this.isLanded) {
          this.isLanded = true;
        }
        // this._handleLanding();
      }
    }


    // Tree collisions still handled by Rapier
    this.world.contactPairsWith(this.collider, (otherCollider) => {
      // // @ts-expect-error
      // if (otherCollider.userData?.type === 'tree') {
      //   const ballPos = this.rigidBody.translation();
      //   const treeBody = otherCollider.parent();
      //   if (!treeBody) return;
      //   const treePos = treeBody.translation();

      //   const dx = ballPos.x - treePos.x;
      //   const dz = ballPos.z - treePos.z;
      //   const dist = Math.sqrt(dx * dx + dz * dz);

      //   if (dist < 0.01) {
      //     const angle = Math.random() * Math.PI * 2;
      //     this.rigidBody.setLinvel({
      //       x: Math.cos(angle) * 2, y: 2, z: Math.sin(angle) * 2
      //     }, true);
      //   } else {
      //     const nx = dx / dist;
      //     const nz = dz / dist;
      //     const lv = this.rigidBody.linvel();
      //     const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      //     const pushSpeed = Math.max(speed * 0.3, 1.0);
      //     this.rigidBody.setLinvel({
      //       x: nx * pushSpeed, y: Math.max(lv.y, 0.5), z: nz * pushSpeed
      //     }, true);
      //   }
      // }
    });

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const c1 = this.world.getCollider(handle1);
      const c2 = this.world.getCollider(handle2);
      if (isColliderWithUserData(c1)) {
        this.currentSurface = c1.userData;
      }
    });
  }

_updateAirPhysics(dt: number) {
    // const pos = this.rigidBody.translation();
    // const lv = this.rigidBody.linvel();
    // const av = this.rigidBody.angvel();
    // const vel = this.#vel.set(lv.x, lv.y, lv.z);
    // const spin = this.#spin.set(av.x, av.y, av.z);

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

    // Update rigid body state
    // this.rigidBody.setTranslation({ x: newX, y: newY, z: newZ }, true);
    // this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    // this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    pos.set(newX, newY, newZ);

    // Set mesh directly from float64 values to avoid float32 roundtrip jitter
    // this.mesh.position.set(newX, newY, newZ);

    // Track airborne
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
        // this.#position.set(newX, newY, newZ);
        // this.#velocity.copy(vel);
        // this.#angularVel.copy(spin);
      }
    }
  }  
  
  // Sync Three.js mesh to Rapier body
  syncMesh() {
    const pos = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);

    // Make absolute sure the ball can never go past the lowest Y value
    const p = this.rigidBody.translation();
    if (p.y < -10) {
      // Ball has fallen into the void — recover to last known good position
      const recoveryY = this.getTerrainHeight(p.x, p.z) + this.ballRadius;
      this.rigidBody.setTranslation({ x: p.x, y: recoveryY, z: p.z }, true);
      this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
      this.isGrounded = true;
      this.isLanded = true;
      this.syncMesh();
    }    
  }

  // Main update called every frame with a fixed dt
  update(dt: number) {
    if (!this.isShotActive) return;

    if (!this.isLanded) {
      this._updateAirPhysics(dt);
    } else {
      // Use custom ground physics once landed
      this._updateGroundPhysics(dt);
    }

    // Set mesh position once per step from physics state
    this.mesh.position.copy(this.#position);

    // this.syncMesh();

    // Check if ball has come to rest
    if (this.isGrounded && !this.isEnded) {
      // const lv = this.rigidBody.linvel();
      // const av = this.rigidBody.angvel();
      // const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      // const angSpeed = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
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
    // this.freeze();
    this.isShotActive = false;
    this.emit('shotEnded', this.currentSurface);
  }

  _checkTreeCollision(pos: Vector, vel: THREE.Vector3, spin: THREE.Vector3, dt: number) {
    const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (horizontalSpeed < 0.01) return false;

    const dir = new THREE.Vector3(vel.x, 0, vel.z).normalize();
    const dist = horizontalSpeed * dt + this.ballRadius;

    const ray = new this.rapier.Ray(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: dir.x, y: 0, z: dir.z }
    );

    const hit = this.world.castRayAndGetNormal(ray, dist, true, undefined, undefined, undefined, this.rigidBody);
    if (!hit || !isColliderWithUserData(hit?.collider)) return false
    if (hit.collider.userData?.type !== CourseObjectType.Tree) return false;

    const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
    vel.reflect(n);
    vel.multiplyScalar(0.25);
    vel.y = 0;
    spin.multiplyScalar(0.3);

    return true;
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
    // const pos = this.rigidBody.translation();
    // const lv = this.rigidBody.linvel();
    // const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
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
        // settled
        // this.rigidBody.setTranslation({ x: nx, y: bottomY, z: nz }, true);
        // this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
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

    // this.rigidBody.setTranslation({ x: nx, y: ny, z: nz }, true);
    // this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    pos.set(nx, ny, nz);
    // this.mesh.position.copy(pos);
  }


  _updateGroundPhysics(dt: number) {
    // Falling into hole check
    if (this.holeState === 'falling') {
      console.log('Ball is falling into hole');
      this._updateCupFall(dt);
      return;
    }
    // if (this.holeState === 'over') {
    //   this._updateHoleCrossing(dt);
    //   return;
    // }
    // const exitingHole = this.holeState === 'exiting';
    // if (exitingHole) {
    //   this.holeState = 'none';
    // }
    // const pos = this.rigidBody.translation();
    // const lv = this.rigidBody.linvel();
    // const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    // const av = this.rigidBody.angvel();
    // const spin = new THREE.Vector3(av.x, av.y, av.z);

    const pos = this.#position;
    const vel = this.#velocity;
    const spin = this.#angularVel;

    const t0 = performance.now();

    // // Tree collision check — if hit, apply response and skip this frame
    // if (this._checkTreeCollision(pos, vel, spin, dt)) {
    //   this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    //   this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    //   this.syncMesh();
    //   return;
    // }

    // Apply gravity
    vel.y -= GRAVITY * dt;

    // Move
    const newX = pos.x + vel.x * dt;
    const newZ = pos.z + vel.z * dt;
    const newY = pos.y + vel.y * dt;

    const terrain = this.getTerrainInfo(newX, newZ);
    const terrainY = terrain.height;
    // console.log('terrain.userData', terrain);
    const normal = terrain.normal;
    // const normal = this._getTerrainNormal(newX, newZ);
    // console.log(`getTerrainInfo: ${(performance.now() - t0).toFixed(1)}ms`);

    
    // if (this._checkHole(pos, newX, newZ, vel, terrainY)) {
    if (this.holeState !== 'exiting' && this._checkHole(pos, newX, newZ, vel, terrainY)) {

      // pos.set(newX, newY, newZ);
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
        // Keep Y at terrain height
        pos.y = terrainY + this.ballRadius;
      }

      // this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      // this.syncMesh();
      // this.mesh.position.copy(pos);
      return;
    }
    
    // const t1 = performance.now();
    // console.log(`_checkHole: ${(performance.now() - t1).toFixed(1)}ms`);

    if (this._checkWaterCollision()) {
      this.mesh.visible = false;
      this._endShot();
      return;
    }
    // const t2 = performance.now();
    // console.log(`_checkHole: ${(performance.now() - t2).toFixed(1)}ms`);    
    
    this.currentSurface = terrain?.surface;

    const minY = terrainY + (this.ballRadius * 2);

    // if (newY <= minY) {
    if (newY <= minY && this.holeState !== 'exiting') {
      
      // === BOUNCE or ROLL ===
      const speed = vel.length();
      const impactVelAlongNormal = -vel.dot(normal);

      if (impactVelAlongNormal > 0.5) {
        // Descent angle — 0 = shallow, 1 = straight down
        const descentAngle = Math.abs(vel.y) / speed;

        const restitutionRaw = this.currentSurface?.restitution ?? 0.25; // this._getRestitution(speed);
        // Steep descent = more energy absorbed by turf
        const descentRestitution = THREE.MathUtils.lerp(1.0, 0.8, descentAngle);
        const restitution = restitutionRaw * descentRestitution;
        // Steep descent also kills more forward momentum
        const tangentRetention = THREE.MathUtils.lerp(0.9, 0.5, descentAngle);

        vel.reflect(normal);

        // const normalComponent = vel.clone().projectOnVector(normal);
        // const tangentComponent = vel.clone().sub(normalComponent);
        const normalComponent = this.#normalComponent.copy(vel).projectOnVector(normal);
        const tangentComponent = this.#tangentComponent.copy(vel).sub(normalComponent);

        vel.copy(tangentComponent.multiplyScalar(tangentRetention))
          .add(normalComponent.multiplyScalar(restitution));

        this._handleLanding();
        // const spinMag = spin.length();
        // console.log('Bounce spin magnitude:', spinMag.toFixed(1), 'rad/s');
        // if (spinMag > 1.0) {
        //   const forward = tangentComponent.clone().normalize();
        //   const up = normal.clone();
        //   const right = new THREE.Vector3().crossVectors(up, forward).normalize();

        //   // Negative because launch sets backspin along -right (localLeft)
        //   const backspin = -spin.dot(right);
        //   const sidespin = spin.dot(up);

        //   const backspinEffect = 0.005;
        //   const sidespinEffect = 0.002;

        //   // Backspin reduces forward speed, topspin increases it
        //   vel.addScaledVector(forward, -backspin * backspinEffect);

        //   // Sidespin kicks ball sideways
        //   vel.addScaledVector(right, sidespin * sidespinEffect);

        //   console.log('Backspin:', backspin.toFixed(1), 'Sidespin:', sidespin.toFixed(1));

        //   spin.multiplyScalar(0.6);
        // }

        // this.rigidBody.setTranslation(
        //   { x: newX, y: terrainY + this.ballRadius, z: newZ }, true
        // );
        // this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
        // this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);

        pos.set(newX, terrainY + this.ballRadius, newZ);
        // this.mesh.position.copy(pos);        
      } else {
        // Handle rolling
        this.isGrounded = true;

        // Project velocity onto surface plane
        // vel.sub(normal.clone().multiplyScalar(vel.dot(normal)));
        vel.sub(this.#normalClone.copy(normal).multiplyScalar(vel.dot(normal)));

        // // Slope acceleration
        // // const gravity = new THREE.Vector3(0, -GRAVITY, 0);
        // // const slopeForce = gravity.clone().sub(
        // //   normal.clone().multiplyScalar(gravity.dot(normal))
        // // );
        // const gravity = this.#gravity.set(0, -GRAVITY, 0);
        // const slopeForce = this.#slopeForce.copy(gravity).sub(
        //   this.#normalClone.copy(normal).multiplyScalar(gravity.dot(normal))
        // );
        // vel.add(slopeForce.multiplyScalar(dt));

        // Rolling resistance
        // const resistance = this._getRollingResistance();
        let resistance = this.currentSurface?.rollResistance ?? CourseSurfaces.base.rollResistance;
        // if (this.isPutt) {
        //   resistance *= 0.25;
        // }
        const horizontalSpeedThreshold = this.currentSurface?.rollResistanceSpeedThreshold ?? CourseSurfaces.base.rollResistanceSpeedThreshold;
        const horizontalSpeed = vel.length();
        // if (horizontalSpeed > horizontalSpeedThreshold) {
          // const friction = Math.min(resistance * GRAVITY * dt, horizontalSpeed);
          // vel.addScaledVector(vel.clone().normalize(), -friction);
          // Coulomb friction (constant deceleration) — dominates at high speed
          // vel.addScaledVector(vel.clone().normalize(), -friction);
          
          // const friction = Math.min(resistance * GRAVITY * dt, horizontalSpeed);
          const normalForce = normal.y; // cos(θ): 1.0 on flat, less on slopes
          const friction = Math.min(resistance * GRAVITY * normalForce * dt, horizontalSpeed);


          vel.addScaledVector(this.#normalClone.copy(vel).normalize(), -friction);

          // // Viscous damping — dominates at low speed, prevents endless creep
          // if (!this.isPutt) {
          //   const dampingFactor = Math.exp(-resistance * 8.0 * dt);
          //   vel.multiplyScalar(dampingFactor);
          // }
          const dampingMultiplier = this.isPutt ? 3.0 : 8.0;
          const dampingFactor = Math.exp(-resistance * dampingMultiplier * normalForce * dt);
          vel.multiplyScalar(dampingFactor);

        // }
        // Hard cutoff — anything below this is just numerical noise
        if (vel.length() < 0.02) {
          vel.set(0, 0, 0);
        }

        // Spin deflection during roll — ω × r gives surface velocity at contact
        if (spin.length() > 1.0 && horizontalSpeed > 0.1) {
          // const contactPoint = normal.clone().multiplyScalar(-this.ballRadius);
          // const spinSurfaceVel = new THREE.Vector3().crossVectors(spin, contactPoint);
          const contactPoint = this.#normalClone.copy(normal).multiplyScalar(-this.ballRadius);
          const spinSurfaceVel = this.#slopeForce.crossVectors(spin, contactPoint);
          vel.addScaledVector(spinSurfaceVel, -this.gripStrength * dt);
        }

        // this.rigidBody.setTranslation(
        //   { x: newX, y: terrainY + this.ballRadius, z: newZ }, true
        // );
        // this.rigidBody.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);

        // // Ground spin decay
        // const grassDampen = 4.5;
        // if (spin.length() > 3.0) {
        //   const factor = THREE.MathUtils.clamp(1 - grassDampen * dt, 0, 1);
        //   spin.multiplyScalar(factor);
        // }
        // this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);

        pos.set(newX, terrainY + this.ballRadius, newZ);
        // vel.y = 0;
        // if (!exitingHole) vel.y = 0;
        vel.y = 0;
        // this.mesh.position.copy(pos);

      }
    } else {
      // Airborne between bounces
      this.isGrounded = false;
      this.currentSurface = undefined;
      // this.rigidBody.setTranslation({ x: newX, y: newY, z: newZ }, true);
      // this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      pos.set(newX, newY, newZ);
      if (this.holeState === 'exiting') {
        this.holeState = 'none';
      }
      // this.mesh.position.copy(pos);
    }

    // Final check for lowest ground point (don't let the ball fall through)
    // const finalPos = this.rigidBody.translation();
    // // const safeY = this.getTerrainHeight(finalPos.x, finalPos.z) + this.ballRadius;
    // const checkY = this.getTerrainHeight(finalPos.x, finalPos.z);
    const checkY = this.getTerrainHeight(pos.x, pos.z);
    const safeY = (checkY + this.ballRadius);


    // if (finalPos.y < safeY) {
    // if (finalPos.y < safeY - 0.005) {
    if (pos.y < safeY - 0.005) {
      console.warn('Ball fallen below ground');
      // this.rigidBody.setTranslation(
      //   { x: finalPos.x, y: safeY, z: finalPos.z }, true
      // );
      // // Kill downward velocity so it doesn't immediately tunnel again
      // const lv = this.rigidBody.linvel();
      // if (lv.y < 0) {
      //   this.rigidBody.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
      // }
      pos.y = safeY;
      if (vel.y < 0) vel.y = 0;
      // this.mesh.position.copy(pos);
    }
  }

  _getRollingResistance() {
    // TODO: query surface type at ball position
    // if (this.isPutt) return 0.65;
    return 0.45;
  }

  getTerrainInfo(x: number, z: number) {
    // // const ray = new this.rapier.Ray(
    // //   new this.rapier.Vector3(x, 500, z),
    // //   new this.rapier.Vector3(0, -1, 0)
    // // );
    // // const hit = this.world.castRay(ray, 1000, true);
    // // if (!hit || !isColliderWithUserData(hit.collider)) {
    // //   return this.#lastTerrainInfo;
    // // }
    // this.#rayOrigin.set(x, 500, z);

    // let closestDist = Infinity;
    // let closestPoint: THREE.Vector3 | null = null;
    // let closestMesh: THREE.Mesh | null = null;

    // for (const { bvh, mesh } of this.#terrainBVHs) {
    //   this.#invMatrix.copy(mesh.matrixWorld).invert();
    //   this.#terrainRay.origin.copy(this.#rayOrigin).applyMatrix4(this.#invMatrix);
    //   this.#terrainRay.direction.copy(this.#rayDirection).transformDirection(this.#invMatrix);

    //   const hit = bvh.raycastFirst(this.#terrainRay);
    //   if (hit) {
    //     hit.point.applyMatrix4(mesh.matrixWorld);
    //     const dist = this.#rayOrigin.distanceTo(hit.point);
    //     if (dist < closestDist) {
    //       closestDist = dist;
    //       closestPoint = hit.point;
    //       closestMesh = mesh;
    //     }
    //   }
    // }

    // if (!closestPoint || !closestMesh) {
    if (!this.#mergedBVH) {
      return this.#lastTerrainInfo;
    }

    // // const collider = this.world.getCollider(hit.colliderHandle);
    // // Or if using newer Rapier: hit.collider directly
    // const surface = closestMesh.userData as CourseSurfaceProperties | undefined;

    this.#terrainRay.origin.set(x, 500, z);
    this.#terrainRay.direction.set(0, -1, 0);

    const hit = this.#mergedBVH.raycastFirst(this.#terrainRay);
    if (!hit) {
      return this.#lastTerrainInfo;
    }

    // // Find which surface this triangle belongs to
    // let surface: CourseSurfaceProperties | undefined;
    // if (hit.faceIndex != null && this.#mergedMesh.geometry.groups.length > 0) {
    //   const vertIndex = hit.faceIndex * 3;
    //   for (const group of this.#mergedMesh.geometry.groups) {
    //     if (vertIndex >= group.start && vertIndex < group.start + group.count) {
    //       surface = this.#surfaceMap[group.materialIndex ?? 0];
    //       console.log(`surface: `, surface);
    //       break;
    //     }
    //   }
    // }
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

    // const surfaceSettings = isCourseSurfaceType(surfaceKey)
    //   ? CourseSurfaces[surfaceKey]
    //   : CourseSurfaces.base;

    const validSurfaceKey = isCourseSurfaceType(surfaceKey) ? surfaceKey : CourseSurfaceType.Base;
    const surfaceSettings = CourseSurfaces[validSurfaceKey];

    // const normal = hit.face
    //   ? hit.face.normal.clone()
    //   : new THREE.Vector3(0, 1, 0);
    const normal = hit.face
      ? this.#hitNormal.copy(hit.face.normal)
      : this.#hitNormal.set(0, 1, 0);

    this.#lastTerrainInfo = {
      // height: 500 - hit.timeOfImpact,
      // restitution: hit.collider.restitution(),
      // friction: hit.collider.friction(),
      // surface: hit.collider.userData,
      // height: closestPoint.y,
      height: hit.point.y,
      restitution: surfaceSettings.restitution ?? 0.35,
      friction: surfaceSettings.friction ?? 0.6,
      surface: { type: validSurfaceKey, ...surfaceSettings },
      normal
      // surface: { type: surfaceKey as CourseColliderType, ...surfaceSettings },

      // restitution: surface?.restitution ?? 0.35,
      // friction: surface?.friction ?? 0.6,
      // surface,
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
    // const centrality = Math.max(0, 1 - closestDist / R);
    const centrality = Math.max(0, 1 - closestDist / (R + r));


    // Fall-in speed threshold — linear scale with centrality
    // Dead center: up to ~7 mph (3.0 m/s) drops in
    // Half off-center: up to ~4.5 mph (2.0 m/s)
    // Rim edge: up to ~2 mph (1.0 m/s)
    // const fallInSpeed = 1.0 + centrality * 2.0;
    const fallInSpeed = 1.0 + centrality * 2.5;

    if (vh < fallInSpeed) {
      this._enterCup(terrainY);
      return true;
    }

    // === Ball crosses too fast to drop — compute lip-out ===
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
      // const offCenter = 1.0 - centrality;
      // const deflectionStrength = dipFactor * (0.3 + offCenter * 0.8);
      // vel.x += (awayX / awayDist) * deflectionStrength;
      // vel.z += (awayZ / awayDist) * deflectionStrength;

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
      // const deflectAmount = dipFactor * offCenter * 0.5;
      // Only off-center crossings get tangential curve
      // Dead center = no sideways deflection, just vertical bounce

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