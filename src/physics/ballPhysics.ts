import * as THREE from 'three';
import {
  type World,
  type EventQueue,
  type RigidBody,
  type Vector
} from '@dimforge/rapier3d-compat';
import EventEmitter from 'eventemitter3';
import { UnitConversions } from '@/utils/units';
import { CourseSurfaceProperties, CourseObjectType } from '@/courses/surfaces';
import { PhysicsLookupTable, GRAVITY, isColliderWithUserData, ColliderWithUserData } from './constants';

interface BallPhysicsEvents {
  shotEnded: (surface: CourseSurfaceProperties | undefined) => void;
}

type TerrainInfo = {
  height: number,
  restitution: number,
  friction: number,
  surface?: CourseSurfaceProperties;
}

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
  gripStrength = 2.8;

  // State flags
  isPutt = false;
  isLanded = false;
  isGrounded = false;
  isEnded = false;
  isShotActive = false;
  hasBeenAirborne = false;
  currentSurface?: CourseSurfaceProperties;

  // Thresholds
  defaultEndThresholdSpeed = 0.15;   // m/s linear
  defaultEndThresholdAngular = 6.0;  // rad/s
  shotFrames = 0;
  groundedFrames = 0;
  groundedFramesRequired = 10; // consecutive grounded steps before "rolling"

  eventQueue: EventQueue;
  rigidBody: RigidBody;
  collider: ColliderWithUserData;
  ballColliderHandle: number;
  
  #lastTerrainInfo: TerrainInfo = {
    height: 0,
    restitution: 0.35,
    friction: 0.6
  }

  constructor(mesh: THREE.Object3D, world: World, rapier: RapierInstance, radius = 0.021335) {
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

    // Store the collider handle so we can identify it in events
    this.ballColliderHandle = this.collider.handle;

    // Start frozen
    this.freeze();
  }

  /** Set elevation and air density */
  setElevation(meters: number) {
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
          launchAngle: l(a.launchAngle, b.launchAngle, t),
          magnusCoeff: l(a.magnusCoeff, b.magnusCoeff, t),
          dragCoeff: l(a.dragCoeff, b.dragCoeff, t),
          spinDecayRate: l(a.spinDecayRate, b.spinDecayRate, t),
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
    this.freeze();
    this.rigidBody.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.resetForces(true);
    this.rigidBody.resetTorques(true);
    // Also clear any internal state flags you keep (collision-entered, etc.)
    this.rigidBody.wakeUp();
    
    this.isLanded = false;
    this.isGrounded = false;
    this.isEnded = false;
    this.groundedFrames = 0;
    this.syncMesh();
  }
  
  remove() {
    this.world.removeRigidBody(this.rigidBody);
    // this.world.removeCollider(this.groundCollider, wakeUp);
  }

  launchShot(shot: OpenGolfSim.Shot, isPutt = false) {
    const ballSpeed = UnitConversions.milesPerHourToMetersPerSecond(shot.ballSpeed);
    
    const vlaMin = isPutt ? 0 : 1;
    const vla = Math.min(Math.max(shot.verticalLaunchAngle || 0, vlaMin), 45);

    // Reset state
    this.hasBeenAirborne = false;
    this.isLanded = isPutt;
    this.isGrounded = isPutt;
    this.isEnded = false;
    this.isPutt = isPutt;
    this.groundedFrames = 0;
    this.shotFrames = 0;

    // Unfreeze
    this.unfreeze();
    this.isShotActive = true;
    // Disable CCD during launch — re-enable once airborne
    // this.rigidBody.enableCcd(false);

    if (isPutt) {
      this._launchPutt(ballSpeed, shot.horizontalLaunchAngle || 0);
    } else {
      this._launchFull(
        ballSpeed, vla,
        shot.horizontalLaunchAngle || 0,
        shot.spinSpeed || 0,
        shot.spinAxis || 0,
      );
    }
  }

  _launchPutt(speed: number, hla: number) {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const qH = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(-hla),
    );
    dir.applyQuaternion(qH).normalize().multiplyScalar(speed);
    this.rigidBody.setLinvel({ x: dir.x, y: dir.y, z: dir.z }, true);
  }

  _launchFull(speed: number, vla: number, hla: number, spinRPM: number, spinAxisDeg: number) {
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

    this.rigidBody.setLinvel({ x: dir.x, y: dir.y, z: dir.z }, true);

    // Spin
    const spinRad = spinRPM * 2 * Math.PI / 60;
    const axisRad = THREE.MathUtils.degToRad(spinAxisDeg);
    const localLeft = right.clone().multiplyScalar(-1);

    const spinVec = new THREE.Vector3()
      .addScaledVector(localLeft, Math.cos(axisRad))
      .addScaledVector(up, Math.sin(axisRad))
      .multiplyScalar(spinRad);

    this.rigidBody.setAngvel({ x: spinVec.x, y: spinVec.y, z: spinVec.z }, true);

    // Set coefficients
    const coeffs = this.interpolateBySpeed(speed);
    this.magnusCoeff = coeffs.magnusCoeff;
    this.dragCoeff = coeffs.dragCoeff;
    this.spinDecayRate = coeffs.spinDecayRate;
  }

  // ─── Per-frame forces ────────────────────────────────────────────
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
    const decay = Math.pow(this.spinDecayRate, dt / 0.02);
    spin.multiplyScalar(decay);
    this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
  }


  // ─── Collision event processing ──────────────────────────────────
  _processCollisions() {
    let touching = false;

    this.shotFrames++;
    // this.world.contactPairsWith(this.collider, (otherCollider) => {
    //   touching = true;
    // });

    // Detect airborne via velocity: ball was launched upward, 
    // give it a few frames to clear the ground, then once it's
    // descending we know it's been up and is coming back down.
    if (!this.hasBeenAirborne && this.shotFrames > 3) {
      const lv = this.rigidBody.linvel();
      if (lv.y < 0) {
        this.hasBeenAirborne = true;
      }
    }

    this.world.contactPairsWith(this.collider, (otherCollider) => {
      // @ts-expect-error
      if (otherCollider.userData?.type === 'tree') {
        // Push ball away from tree center
        const ballPos = this.rigidBody.translation();
        const treeBody = otherCollider.parent();
        if (!treeBody) {
          return;
        }
        const treePos = treeBody.translation();

        const dx = ballPos.x - treePos.x;
        const dz = ballPos.z - treePos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < 0.01) {
          // Directly on top of tree center — pick a random direction
          const angle = Math.random() * Math.PI * 2;
          this.rigidBody.setLinvel({
            x: Math.cos(angle) * 2,
            y: 2,
            z: Math.sin(angle) * 2
          }, true);
        } else {
          // Push outward from tree trunk
          const nx = dx / dist;
          const nz = dz / dist;
          const lv = this.rigidBody.linvel();
          const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
          const pushSpeed = Math.max(speed * 0.3, 1.0);

          this.rigidBody.setLinvel({
            x: nx * pushSpeed,
            y: Math.max(lv.y, 0.5),
            z: nz * pushSpeed
          }, true);
        }
        return;
      }

      touching = true;
    });

    if (touching) {
      if (this.hasBeenAirborne && !this.isLanded) {
        console.log('LANDED', this.hasBeenAirborne);
        this.isLanded = true;
      }
      this.groundedFrames++;
      if (this.groundedFrames >= this.groundedFramesRequired) {
        this.isGrounded = true;
      }
    } else {
      this.hasBeenAirborne = true;
      this.isGrounded = false;
      this.groundedFrames = 0;
    }

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      const c1 = this.world.getCollider(handle1);
      const c2 = this.world.getCollider(handle2);
      if (isColliderWithUserData(c1)) {
        this.currentSurface = c1.userData;
      }
    });
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
      // Rapier handles ball in flight
      this._applyAirForces(dt);
      this.world.timestep = dt;
      this.world.step(this.eventQueue);
      this._processCollisions();
    } else {
      // Use custom ground physics once landed
      this._updateGroundPhysics(dt);
    }

    this.syncMesh();

    // Check if ball has come to rest
    if (this.isGrounded && !this.isEnded) {
      const lv = this.rigidBody.linvel();
      const av = this.rigidBody.angvel();
      const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      const angSpeed = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);

      const endThresholdSpeed = this.currentSurface?.stopSpeed ?? this.defaultEndThresholdSpeed;
      const endThresholdAngular = this.currentSurface?.stopAngular ?? this.defaultEndThresholdAngular;
      if (speed < endThresholdSpeed && angSpeed < endThresholdAngular) {
        this._endShot();
      }
    }
  }

  _endShot() {
    this.isEnded = true;
    this.freeze();
    this.emit('shotEnded', this.currentSurface);
    // if (this.onShotEnded) this.onShotEnded(this.currentSurface);
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
  _updateGroundPhysics(dt: number) {
    const pos = this.rigidBody.translation();
    const lv = this.rigidBody.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const av = this.rigidBody.angvel();
    const spin = new THREE.Vector3(av.x, av.y, av.z);

    // Tree collision check — if hit, apply response and skip this frame
    if (this._checkTreeCollision(pos, vel, spin, dt)) {
      this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
      this.syncMesh();
      return;
    }

    // Apply gravity
    vel.y -= GRAVITY * dt;

    // Move
    const newX = pos.x + vel.x * dt;
    const newZ = pos.z + vel.z * dt;
    const newY = pos.y + vel.y * dt;

    const terrain = this.getTerrainInfo(newX, newZ);
    const terrainY = terrain.height;
    // console.log('terrain.userData', terrain);
    const normal = this._getTerrainNormal(newX, newZ);
    
    if (this._checkWaterCollision()) {
      this.mesh.visible = false;
      this._endShot();
      return;
    }
    
    this.currentSurface = terrain?.surface;

    

    if (newY <= terrainY + this.ballRadius) {

      // === BOUNCE or ROLL ===
      const speed = vel.length();
      const impactVelAlongNormal = -vel.dot(normal);

      if (impactVelAlongNormal > 0.5) {
        // Descent angle — 0 = shallow, 1 = straight down
        const descentAngle = Math.abs(vel.y) / speed;

        const restitutionRaw = this.currentSurface?.restitution ?? 0.25; // this._getRestitution(speed);
        console.log('restitutionRaw', restitutionRaw);
        // Steep descent = more energy absorbed by turf
        const descentRestitution = THREE.MathUtils.lerp(1.0, 0.8, descentAngle);
        const restitution = restitutionRaw * descentRestitution;
        // Steep descent also kills more forward momentum
        const tangentRetention = THREE.MathUtils.lerp(0.9, 0.5, descentAngle);

        vel.reflect(normal);

        const normalComponent = vel.clone().projectOnVector(normal);
        const tangentComponent = vel.clone().sub(normalComponent);

        vel.copy(tangentComponent.multiplyScalar(tangentRetention))
          .add(normalComponent.multiplyScalar(restitution));

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

        this.rigidBody.setTranslation(
          { x: newX, y: terrainY + this.ballRadius, z: newZ }, true
        );
        this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
        this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);

      } else {
        // Handle rolling
        this.isGrounded = true;

        // Project velocity onto surface plane
        vel.sub(normal.clone().multiplyScalar(vel.dot(normal)));

        // Slope acceleration
        const gravity = new THREE.Vector3(0, -GRAVITY, 0);
        const slopeForce = gravity.clone().sub(
          normal.clone().multiplyScalar(gravity.dot(normal))
        );
        vel.add(slopeForce.multiplyScalar(dt));

        // Rolling resistance
        // const resistance = this._getRollingResistance();
        const resistance = this.currentSurface?.rollResistance ?? this._getRollingResistance();
        const horizontalSpeed = vel.length();
        if (horizontalSpeed > 0.001) {
          // const friction = Math.min(resistance * GRAVITY * dt, horizontalSpeed);
          // vel.addScaledVector(vel.clone().normalize(), -friction);
          // Coulomb friction (constant deceleration) — dominates at high speed
          const friction = Math.min(resistance * GRAVITY * dt, horizontalSpeed);
          vel.addScaledVector(vel.clone().normalize(), -friction);

          // Viscous damping — dominates at low speed, prevents endless creep
          const dampingFactor = Math.exp(-resistance * 8.0 * dt);
          vel.multiplyScalar(dampingFactor);

        }
        // Hard cutoff — anything below this is just numerical noise
        if (vel.length() < 0.02) {
          vel.set(0, 0, 0);
        }

        // Spin deflection during roll — ω × r gives surface velocity at contact
        if (spin.length() > 1.0 && horizontalSpeed > 0.1) {
          const contactPoint = normal.clone().multiplyScalar(-this.ballRadius);
          const spinSurfaceVel = new THREE.Vector3().crossVectors(spin, contactPoint);
          vel.addScaledVector(spinSurfaceVel, -this.gripStrength * dt);
        }

        this.rigidBody.setTranslation(
          { x: newX, y: terrainY + this.ballRadius, z: newZ }, true
        );
        this.rigidBody.setLinvel({ x: vel.x, y: 0, z: vel.z }, true);

        // Ground spin decay
        const grassDampen = 4.5;
        if (spin.length() > 3.0) {
          const factor = THREE.MathUtils.clamp(1 - grassDampen * dt, 0, 1);
          spin.multiplyScalar(factor);
        }
        this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
      }
    } else {
      // Airborne between bounces
      this.isGrounded = false;
      this.currentSurface = undefined;
      this.rigidBody.setTranslation({ x: newX, y: newY, z: newZ }, true);
      this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    }

    // Final check for lowest ground point (don't let the ball fall through)
    const finalPos = this.rigidBody.translation();
    const safeY = this.getTerrainHeight(finalPos.x, finalPos.z) + this.ballRadius;
    if (finalPos.y < safeY) {
      this.rigidBody.setTranslation(
        { x: finalPos.x, y: safeY, z: finalPos.z }, true
      );
      // Kill downward velocity so it doesn't immediately tunnel again
      const lv = this.rigidBody.linvel();
      if (lv.y < 0) {
        this.rigidBody.setLinvel({ x: lv.x, y: 0, z: lv.z }, true);
      }
    }
  }

  _getRollingResistance() {
    // TODO: query surface type at ball position
    if (this.isPutt) return 0.65;
    return 0.45;
  }

  getTerrainInfo(x: number, z: number) {
    const ray = new this.rapier.Ray(
      new this.rapier.Vector3(x, 500, z),
      new this.rapier.Vector3(0, -1, 0)
    );
    const hit = this.world.castRay(ray, 1000, true);
    if (!hit || !isColliderWithUserData(hit.collider)) {
      return this.#lastTerrainInfo;
    }

    // const collider = this.world.getCollider(hit.colliderHandle);
    // Or if using newer Rapier: hit.collider directly
    this.#lastTerrainInfo = {
      height: 500 - hit.timeOfImpact,
      restitution: hit.collider.restitution(),
      friction: hit.collider.friction(),
      surface: hit.collider.userData,
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

}