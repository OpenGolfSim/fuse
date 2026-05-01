// BallPhysics.js
// Golf ball physics using Rapier for rigid body + collision,
// with custom aerodynamic forces (drag, Magnus, spin decay).
//
// Usage:
//
//   await RAPIER.init();
//   const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
//
//   const ballMesh = new THREE.Mesh(sphereGeo, sphereMat);
//   scene.add(ballMesh);
//
//   const physics = new BallPhysics(ballMesh, world, RAPIER);
//
//   // Create ground (or any collider — Rapier handles the rest)
//   physics.createGroundCollider(100, 300);
//
//   // Launch
//   physics.launchShot({ ballSpeed: 150, verticalLaunchAngle: 12, ... });
//
//   // Each frame at a fixed timestep:
//   physics.update(dt);

import * as THREE from 'three';

const MPH_TO_MPS = 0.44704;
const GRAVITY = 9.81;

// ─── Aero lookup table ───────────────────────────────────────────────

class BallAerodynamics {
  constructor(speed, spin, angle, magnusCoeff, dragCoeff, spinDecayRate) {
    this.ballSpeed = speed;
    this.spinRate = spin;
    this.launchAngle = angle;
    this.magnusCoeff = magnusCoeff;
    this.dragCoeff = dragCoeff;
    this.spinDecayRate = spinDecayRate;
  }
}

const DEFAULT_AERO_TABLE = [
  new BallAerodynamics(67, 2500, 10, 0.0004,  0.27, 0.986),
  new BallAerodynamics(64, 3000,  9, 0.00038, 0.27, 0.985),
  new BallAerodynamics(60, 3200, 12, 0.00035, 0.30, 0.985),
  new BallAerodynamics(54, 4700, 14, 0.0001,  0.31, 0.985),
  new BallAerodynamics(48, 6700, 16, 0.00005, 0.32, 0.98),
  new BallAerodynamics(42, 9000, 22, 0.00005, 0.34, 0.98),
  new BallAerodynamics(40,10500, 25, 0.00005, 0.34, 0.98),
];

// ─── Main class ──────────────────────────────────────────────────────

export class BallPhysics {
  /**
   * @param {THREE.Object3D} mesh      — the Three.js ball mesh
   * @param {RAPIER.World}   world     — an initialised Rapier world
   * @param {RAPIER}         RAPIER    — the Rapier module (needed for desc constructors)
   * @param {Function}       [onShotEnded] — optional callback when ball comes to rest
   */
  constructor(mesh, world, RAPIER, onShotEnded = null) {
    this.mesh = mesh;
    this.world = world;

    this.RAPIER = RAPIER;
    this.onShotEnded = onShotEnded;

    // Ball constants
    this.ballRadius = 0.021335;
    this.ballMass = 0.04593;
    this.ballArea = Math.PI * this.ballRadius * this.ballRadius;

    // Air density (adjustable via setElevation)
    this.airDensity = 1.225;
    this.airDensityMin = 1.225;
    this.airDensityMax = 1.0;

    // Aero coefficients latched per-shot
    this.magnusCoeff = 0.00015;
    this.dragCoeff = 0.25;
    this.spinDecayRate = 0.987;

    // Grip for spin-induced deflection on bounce
    this.gripStrength = 0.01;

    // Aero lookup
    this.aeroTable = [...DEFAULT_AERO_TABLE];

    // State flags
    this.isPutt = false;
    this.isLanded = false;
    this.isGrounded = false;
    this.isEnded = false;
    this.isShotActive = false;

    // Thresholds
    this.endShotThresholdSpeed = 0.15;   // m/s linear
    this.endShotThresholdAngular = 6.0;  // rad/s
    this.groundedFrames = 0;
    this.groundedFramesRequired = 10; // consecutive grounded steps before "rolling"

    // Event queue for collision callbacks
    this.eventQueue = new RAPIER.EventQueue(true);




    // ── Create Rapier rigid body ──
    const pos = mesh.position;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(0)
      .setAngularDamping(0)
      .setCcdEnabled(true);              // continuous collision detection
    this.rigidBody = world.createRigidBody(bodyDesc);

    // ── Collider (sphere) ──
    const colliderDesc = RAPIER.ColliderDesc.ball(this.ballRadius)
      .setMass(this.ballMass)
      .setRestitution(0.2)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setFriction(0.6)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.collider = world.createCollider(colliderDesc, this.rigidBody);

    // Store the collider handle so we can identify it in events
    this.ballColliderHandle = this.collider.handle;

    // Start frozen
    this.freeze();
  }

  // ─── World setup helpers ─────────────────────────────────────────

  /**
   * Create a simple flat ground collider.
   * For terrain, create your own trimesh/heightfield collider instead.
   */
  createGroundCollider(width = 100, depth = 300) {
    const RAPIER = this.RAPIER;
    const desc = RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2)
      .setTranslation(0, -0.1, depth / 2)   // top surface sits at y=0
      .setRestitution(0.35)
      .setFriction(0.8);
    this.groundCollider = this.world.createCollider(desc);
    return this.groundCollider;
  }

  /**
   * Create a ground collider from a Three.js mesh (for terrain with slopes).
   * The mesh must have a non-indexed or indexed BufferGeometry.
   */
  createTerrainCollider(terrainMesh) {
    const RAPIER = this.RAPIER;
    const geo = terrainMesh.geometry;

    // Extract vertices and indices
    const posAttr = geo.getAttribute('position');
    const vertices = new Float32Array(posAttr.array);

    // Apply the mesh's world transform to the vertices
    const matrix = terrainMesh.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < vertices.length; i += 3) {
      v.set(vertices[i], vertices[i + 1], vertices[i + 2]);
      v.applyMatrix4(matrix);
      vertices[i] = v.x;
      vertices[i + 1] = v.y;
      vertices[i + 2] = v.z;
    }

    let indices;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      // Non-indexed: generate sequential indices
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(0.35)
      .setFriction(0.8);
    this.groundCollider = this.world.createCollider(desc);
    return this.groundCollider;
  }

  // ─── Elevation / air density ─────────────────────────────────────

  setElevation(meters) {
    if (meters === 0) {
      this.airDensity = this.airDensityMin;
      return;
    }
    const t = THREE.MathUtils.clamp(meters, 0, 10000) / 10000;
    this.airDensity = THREE.MathUtils.lerp(this.airDensityMin, this.airDensityMax, t);
  }

  // ─── Aero interpolation ──────────────────────────────────────────

  interpolateBySpeed(speed) {
    const table = [...this.aeroTable].sort((a, b) => a.ballSpeed - b.ballSpeed);
    if (speed <= table[0].ballSpeed) return table[0];
    if (speed >= table[table.length - 1].ballSpeed) return table[table.length - 1];

    for (let i = 0; i < table.length - 1; i++) {
      const a = table[i], b = table[i + 1];
      if (speed >= a.ballSpeed && speed < b.ballSpeed) {
        const t = (speed - a.ballSpeed) / (b.ballSpeed - a.ballSpeed);
        const l = THREE.MathUtils.lerp;
        return new BallAerodynamics(
          speed,
          l(a.spinRate, b.spinRate, t),
          l(a.launchAngle, b.launchAngle, t),
          l(a.magnusCoeff, b.magnusCoeff, t),
          l(a.dragCoeff, b.dragCoeff, t),
          l(a.spinDecayRate, b.spinDecayRate, t),
        );
      }
    }
    return table[table.length - 1];
  }

  // ─── Freeze / unfreeze ───────────────────────────────────────────

  freeze() {
    this.rigidBody.setBodyType(this.RAPIER.RigidBodyType.Fixed, true);
    this.isShotActive = false;
  }

  unfreeze() {
    this.rigidBody.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true);
  }

  resetTo(position) {
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

  // ─── Launch ──────────────────────────────────────────────────────

  launchShot(shot, isPutt = false) {
    const ballSpeed = shot.ballSpeed * MPH_TO_MPS;
    const vla = Math.min(Math.max(shot.verticalLaunchAngle || 0, 1), 45);

    // Reset state
    this.isLanded = false;
    this.isGrounded = false;
    this.isEnded = false;
    this.isPutt = isPutt;
    this.groundedFrames = 0;

    // Unfreeze
    this.unfreeze();
    this.isShotActive = true;

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

  _launchPutt(speed, hla) {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.mesh.quaternion);
    const qH = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(-hla),
    );
    dir.applyQuaternion(qH).normalize().multiplyScalar(speed);
    this.rigidBody.setLinvel({ x: dir.x, y: dir.y, z: dir.z }, true);
  }

  _launchFull(speed, vla, hla, spinRPM, spinAxisDeg) {
    // ── Velocity ──
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

    // ── Spin ──
    const spinRad = spinRPM * 2 * Math.PI / 60;
    const axisRad = THREE.MathUtils.degToRad(spinAxisDeg);
    const localLeft = right.clone().multiplyScalar(-1);

    const spinVec = new THREE.Vector3()
      .addScaledVector(localLeft, Math.cos(axisRad))
      .addScaledVector(up, Math.sin(axisRad))
      .multiplyScalar(spinRad);

    this.rigidBody.setAngvel({ x: spinVec.x, y: spinVec.y, z: spinVec.z }, true);

    // ── Latch aero coefficients ──
    const coeffs = this.interpolateBySpeed(speed);
    this.magnusCoeff = coeffs.magnusCoeff;
    this.dragCoeff = coeffs.dragCoeff;
    this.spinDecayRate = coeffs.spinDecayRate;
  }

  // ─── Per-frame forces ────────────────────────────────────────────
  _applyAeroForces(dt) {
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

  // _applyAeroForces(dt) {
  //   const lv = this.rigidBody.linvel();
  //   const av = this.rigidBody.angvel();
  //   const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
  //   const spin = new THREE.Vector3(av.x, av.y, av.z);
  //   const vMag = vel.length();
  //   if (vMag < 1e-6) return;

  //   // // Drag: F = -0.5 * Cd * rho * A * |v| * v
  //   // const drag = vel.clone().multiplyScalar(
  //   //   -0.5 * this.dragCoeff * this.airDensity * this.ballArea * vMag
  //   // );
  //   // this.rigidBody.addForce({ x: drag.x, y: drag.y, z: drag.z }, true);

  //   // Magnus (only while airborne)
  //   if (!this.isLanded) {
  //     console.log('apply magnus...');
  //     const magnus = new THREE.Vector3().crossVectors(spin, vel)
  //       .multiplyScalar(this.magnusCoeff * 0.01);
  //     const maxLift = this.ballMass * GRAVITY * 0.83;
  //     if (magnus.length() > maxLift) magnus.setLength(maxLift);
  //     this.rigidBody.addForce({ x: magnus.x, y: magnus.y, z: magnus.z }, true);
  //   }

  //   // Spin decay (framerate-independent)
  //   const decay = Math.pow(this.spinDecayRate, dt / 0.02);
  //   spin.multiplyScalar(decay);
  //   this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
  // }

  _applyGroundFriction(dt) {
    const lv = this.rigidBody.linvel();
    const av = this.rigidBody.angvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const spin = new THREE.Vector3(av.x, av.y, av.z);

    // // Extra rolling friction beyond what Rapier provides
    // const frictionCoeff = 0.5;
    // const horiz = new THREE.Vector3(vel.x, 0, vel.z);
    // if (horiz.length() > 0.2) {
    //   const f = horiz.clone().normalize()
    //     .multiplyScalar(-frictionCoeff * this.ballMass * GRAVITY);
    //   this.rigidBody.addForce({ x: f.x, y: 0, z: f.z }, true);
    // }

    // Spin damping on ground
    const grassDampen = 4.5;
    if (spin.length() > 3.0) {
      const factor = THREE.MathUtils.clamp(1 - grassDampen * dt, 0, 1);
      spin.multiplyScalar(factor);
      this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
    }
  }

  // ─── Collision event processing ──────────────────────────────────
  _processCollisions() {
    let touching = false;

    this.world.contactPairsWith(this.collider, (otherCollider) => {
      touching = true;
    });

    if (touching) {
      if (!this.isLanded) this.isLanded = true;
      this.groundedFrames++;
      if (this.groundedFrames >= this.groundedFramesRequired) {
        this.isGrounded = true;
      }
    } else {
      this.isGrounded = false;
      this.groundedFrames = 0;
    }

    this.eventQueue.drainCollisionEvents(() => {});
  }
  

  // ─── Sync Three.js mesh to Rapier body ───────────────────────────

  syncMesh() {
    const pos = this.rigidBody.translation();
    const rot = this.rigidBody.rotation();
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
  }

  // ─── Main update — call every frame with a fixed dt ──────────────

  update(dt) {
    if (!this.isShotActive) return;

    this._applyAeroForces(dt);
    if (this.isGrounded) {
      this._applyGroundFriction(dt);
    }

    this.world.timestep = dt;
    this.world.step(this.eventQueue);

    this._processCollisions();

    // 5. Sync mesh
    this.syncMesh();

    // 6. Check if ball has come to rest
    if (this.isGrounded && !this.isEnded) {
      const lv = this.rigidBody.linvel();
      const av = this.rigidBody.angvel();
      const speed = Math.sqrt(lv.x * lv.x + lv.y * lv.y + lv.z * lv.z);
      const angSpeed = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);

      if (speed < this.endShotThresholdSpeed && angSpeed < this.endShotThresholdAngular) {
        this.isEnded = true;
        this.freeze();
        if (this.onShotEnded) this.onShotEnded();
      }
    }
  }
}

export class GroundPhysics {
  constructor(mesh, world, RAPIER, options = {}) {
    this.options = { restitution: 0.35, friction: 0.8, ...options };
    this.mesh = mesh;
    this.world = world;
    this.RAPIER = RAPIER;

    const geo = mesh.geometry;
    // Extract vertices and indices
    const posAttr = geo.getAttribute('position');
    const vertices = new Float32Array(posAttr.array);

    // Apply the mesh's world transform to the vertices
    mesh.updateMatrixWorld(true);
    const matrix = mesh.matrixWorld;
    const v = new THREE.Vector3();
    for (let i = 0; i < vertices.length; i += 3) {
      v.set(vertices[i], vertices[i + 1], vertices[i + 2]);
      v.applyMatrix4(matrix);
      vertices[i] = v.x;
      vertices[i + 1] = v.y;
      vertices[i + 2] = v.z;
    }

    let indices;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      // Non-indexed: generate sequential indices
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    }

    const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(this.options.restitution)
      .setFriction(this.options.friction);
    this.collider = this.world.createCollider(desc);
    return this.collider;
  }  
}