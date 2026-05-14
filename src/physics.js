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

const MPH_TO_MPS = 0.44704;
const GRAVITY = 9.81;

export const GRAVITY_VECTOR = { x: 0, y: -GRAVITY, z: 0 };

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
  new BallAerodynamics(42, 9000, 22, 0.00005, 0.34, 0.90),
  new BallAerodynamics(40,10500, 25, 0.00005, 0.34, 0.90),
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
    this.world.integrationParameters.numSolverIterations = 8;
    this.world.integrationParameters.numAdditionalFrictionIterations = 4;

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
    this.gripStrength = 2.8;

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
    this.shotFrames = 0;
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
      .setRestitution(0.0)
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
      .setFriction(0.4);
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
      .setRestitution(0.005)
      .setFriction(0.6);
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
    this.hasBeenAirborne = false;
    this.isLanded = false;
    this.isGrounded = false;
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

    this.shotFrames++;
    // this.world.contactPairsWith(this.collider, (otherCollider) => {
    //   touching = true;
    // });
    this.world.contactPairsWith(this.collider, (otherCollider) => {
      if (otherCollider.userData?.type === 'tree') {
        // Push ball away from tree center
        const ballPos = this.rigidBody.translation();
        const treeBody = otherCollider.parent();
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
      console.log('c1', c1.userData);
      console.log('c2', c2.userData);
    });
  }
  

  // ─── Sync Three.js mesh to Rapier body ───────────────────────────

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

  // ─── Main update — call every frame with a fixed dt ──────────────

  update(dt) {
    if (!this.isShotActive) return;

    if (!this.isLanded) {
      // === FLIGHT ONLY: Rapier handles this ===
      this._applyAeroForces(dt);
      this.world.timestep = dt;
      this.world.step(this.eventQueue);
      this._processCollisions();
    } else {
      // === POST-LANDING: all custom ===
      this._updateGroundPhysics(dt);
    }

    // this._applyAeroForces(dt);

    // if (this.isGrounded) {
    //   this._applyGroundFriction(dt);
    // }

    // this.world.timestep = dt;
    // this.world.step(this.eventQueue);
    // this._processCollisions();

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

  _checkTreeCollision(pos, vel, spin, dt) {
    const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (horizontalSpeed < 0.01) return false;

    const dir = new THREE.Vector3(vel.x, 0, vel.z).normalize();
    const dist = horizontalSpeed * dt + this.ballRadius;

    const ray = new this.RAPIER.Ray(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: dir.x, y: 0, z: dir.z }
    );

    const hit = this.world.castRayAndGetNormal(ray, dist, true, undefined, undefined, undefined, this.rigidBody);
    if (!hit || !hit.collider.userData?.type) return false;
    if (hit.collider.userData.type !== 'tree') return false;

    const n = new THREE.Vector3(hit.normal.x, 0, hit.normal.z).normalize();
    vel.reflect(n);
    vel.multiplyScalar(0.25);
    vel.y = 0;
    spin.multiplyScalar(0.3);

    return true;
  }

  _updateGroundPhysics(dt) {
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

    if (newY <= terrainY + this.ballRadius) {
      // === BOUNCE or ROLL ===
      const speed = vel.length();
      const impactVelAlongNormal = -vel.dot(normal);

      if (impactVelAlongNormal > 0.5) {
        // Descent angle — 0 = shallow, 1 = straight down
        const descentAngle = Math.abs(vel.y) / speed;

        const restitutionRaw = terrain.restitution ?? terrain.userData.restitution ?? this._getRestitution(speed);
        console.log(`bounce with: ${terrain.userData?.type}: ${restitutionRaw}`, terrain.userData);
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
        // === ROLLING ===
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
        const resistance = terrain.userData.rollResistance ?? this._getRollingResistance();
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
  _updateGroundPhysics__(dt) {
    const pos = this.rigidBody.translation();
    const lv = this.rigidBody.linvel();
    const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
    const av = this.rigidBody.angvel();
    const spin = new THREE.Vector3(av.x, av.y, av.z);

    // Apply gravity
    vel.y -= GRAVITY * dt;

    // Move
    const newX = pos.x + vel.x * dt;
    const newZ = pos.z + vel.z * dt;
    const newY = pos.y + vel.y * dt;


    // ── Tree collision check ──
    const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (horizontalSpeed > 0.01) {
      const dir = new THREE.Vector3(vel.x, 0, vel.z).normalize();
      const ray = new this.RAPIER.Ray(
        { x: pos.x, y: pos.y, z: pos.z },
        { x: dir.x, y: 0, z: dir.z }
      );
      const dist = horizontalSpeed * dt + this.ballRadius;
      const hit = this.world.castRay(ray, dist, true);
      if (hit) {
        const collider = hit.collider;
        console.log('collider.userData', collider.userData);
        if (collider.userData?.type === 'tree') {
          // Reflect horizontal velocity and kill most energy
          vel.x *= -0.3;
          vel.z *= -0.3;
          vel.y = Math.max(vel.y, 0.5); // small upward bump so it doesn't clip underground
          spin.multiplyScalar(0.3);

          this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
          this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);
          this.syncMesh();
          return; // skip the rest of this frame's ground physics
        }
      }
    }

    const terrainY = this.getTerrainHeight(newX, newZ);
    const normal = this._getTerrainNormal(newX, newZ);

    if (newY <= terrainY + this.ballRadius) {
      // === BOUNCE or ROLL ===
      const speed = vel.length();
      const impactVelAlongNormal = -vel.dot(normal);

      if (impactVelAlongNormal > 0.5) {
        // Descent angle — 0 = shallow, 1 = straight down
        const descentAngle = Math.abs(vel.y) / speed;

        // Steep descent = more energy absorbed by turf
        // const descentRestitution = THREE.MathUtils.lerp(0.05, 0.01, descentAngle);
        // const restitution = this._getRestitution(speed) * descentRestitution;
        // // Steep descent also kills more forward momentum
        const tangentRetention = THREE.MathUtils.lerp(0.9, 0.5, descentAngle);

        // vel.reflect(normal);

        // const normalComponent = vel.clone().projectOnVector(normal);
        // const tangentComponent = vel.clone().sub(normalComponent);

        // vel.copy(tangentComponent.multiplyScalar(tangentRetention))
        //   .add(normalComponent.multiplyScalar(restitution));

        // === BOUNCE ===
        const restitution = this._getRestitution(speed);
        vel.reflect(normal);

        const normalComponent = vel.clone().projectOnVector(normal);
        const tangentComponent = vel.clone().sub(normalComponent);

        vel.copy(tangentComponent.multiplyScalar(tangentRetention))
          .add(normalComponent.multiplyScalar(restitution));

        const spinMag = spin.length();
        if (spinMag > 1.0) {
          const forward = tangentComponent.clone().normalize();
          const up = normal.clone();
          const right = new THREE.Vector3().crossVectors(up, forward).normalize();

          // Negative because launch sets backspin along -right (localLeft)
          const backspin = -spin.dot(right);
          const sidespin = spin.dot(up);

          const backspinEffect = 0.005;
          // const sidespinEffect = 0.002;

          // Apply as direct velocity change — tuned for gameplay
          // const backspinEffect = -0.1;  // tune this: higher = more check/release
          const sidespinEffect = 0.002;  // tune this: higher = more lateral kick

          // Backspin reduces forward speed, topspin increases it
          vel.addScaledVector(forward, -backspin * backspinEffect);

          // Sidespin kicks ball sideways
          vel.addScaledVector(right, sidespin * sidespinEffect);


          spin.multiplyScalar(0.6);
        }

        // // Spin effect on bounce — ω × r gives surface velocity at contact
        // if (spin.length() > 10) {
        //   const contactPoint = normal.clone().multiplyScalar(-this.ballRadius);
        //   const spinSurfaceVel = new THREE.Vector3().crossVectors(spin, contactPoint);
        //   vel.addScaledVector(spinSurfaceVel, -this.gripStrength);

        //   spin.multiplyScalar(0.6);
        // }

        this.rigidBody.setTranslation(
          { x: newX, y: terrainY + this.ballRadius, z: newZ }, true
        );
        this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
        this.rigidBody.setAngvel({ x: spin.x, y: spin.y, z: spin.z }, true);

      } else {
        // === ROLLING ===
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
        const resistance = this._getRollingResistance();
        const horizontalSpeed = vel.length();
        if (horizontalSpeed > 0.001) {
          const friction = Math.min(resistance * GRAVITY * dt, horizontalSpeed);
          vel.addScaledVector(vel.clone().normalize(), -friction);
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
      this.rigidBody.setTranslation({ x: newX, y: newY, z: newZ }, true);
      this.rigidBody.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
    }
  }

  _getRestitution(speed) {
    // Faster impacts = less bouncy (energy absorbed by turf)
    if (speed > 30) return 0.25;
    if (speed > 15) return 0.30;
    return 0.35;
  }

  _getRollingResistance() {
    // TODO: query surface type at ball position
    if (this.isPutt) return 0.65;
    return 0.45;
  }

  getTerrainInfo(x, z) {
    const ray = new this.RAPIER.Ray(
      new this.RAPIER.Vector3(x, 500, z),
      new this.RAPIER.Vector3(0, -1, 0)
    );
    const hit = this.world.castRay(ray, 1000, true);
    if (!hit) {
      return this._lastTerrainInfo ?? {
        height: 0, restitution: 0.35, friction: 0.6, userData: {}
      };
    }

    // const collider = this.world.getCollider(hit.colliderHandle);
    // Or if using newer Rapier: hit.collider directly

    const info = {
      height: 500 - hit.timeOfImpact,
      restitution: hit.collider.restitution(),
      friction: hit.collider.friction(),
      userData: hit.collider.userData ?? {},
    };
    this._lastTerrainInfo = info;
    return info;
  }
  getTerrainHeight(x, z) {
    return this.getTerrainInfo(x, z).height;
  }
  // getTerrainHeight(x, z) {
  //   const ray = new this.RAPIER.Ray(
  //     new this.RAPIER.Vector3(x, 500, z),
  //     new this.RAPIER.Vector3(0, -1, 0)
  //   );
  //   const hit = this.world.castRay(ray, 1000, true);
  //   if (!hit) {
  //     // No terrain found — return last known good height or a safe default
  //     console.warn(`getTerrainHeight miss at (${x.toFixed(1)}, ${z.toFixed(1)})`);
  //     return this._lastKnownTerrainY ?? 0;
  //   }
  //   this._lastKnownTerrainY = 500 - hit.timeOfImpact;
  //   return this._lastKnownTerrainY;
  // }


  _getTerrainNormal(x, z) {
    const eps = 0.1;
    const hL = this.getTerrainHeight(x - eps, z);
    const hR = this.getTerrainHeight(x + eps, z);
    const hD = this.getTerrainHeight(x, z - eps);
    const hU = this.getTerrainHeight(x, z + eps);
    return new THREE.Vector3(hL - hR, 2 * eps, hD - hU).normalize();
  }

}

export class Heightfield {
  constructor(float32Heights, world, RAPIER, config = {}) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.heights = float32Heights;
    this.resolution = config.resolution;
    this.maxHeight = config.maxHeight;
    this.bounds = config.bounds;
    this.spanX = config.bounds.maxX - config.bounds.minX;
    this.spanZ = config.bounds.maxZ - config.bounds.minZ;
  }

  createMeshCollider() {
    const step = 4; // 1024/4 = 256x256 grid, plenty for physics
    const cols = Math.floor(this.resolution / step);
    const rows = Math.floor(this.resolution / step);

    const vertices = new Float32Array(cols * rows * 3);
    const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols + c) * 3;
        vertices[idx]     = this.bounds.minX + (c / (cols - 1)) * this.spanX;
        vertices[idx + 1] = this.heights[(r * step) * this.resolution + (c * step)];
        vertices[idx + 2] = this.bounds.minZ + (r / (rows - 1)) * this.spanZ;
      }
    }

    let ti = 0;
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = r * cols + c;
        indices[ti++] = tl;
        indices[ti++] = tl + cols;
        indices[ti++] = tl + 1;
        indices[ti++] = tl + 1;
        indices[ti++] = tl + cols;
        indices[ti++] = tl + cols + 1;
      }
    }

    const desc = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(0.35)
      .setFriction(0.8);

    this.collider = this.world.createCollider(desc);
    return this.collider;
  }

  createCollider() {
    // Transpose + flip to fix both alignment AND winding
    // const fixed = new Float32Array(this.heights.length);
    // for (let r = 0; r < this.resolution; r++) {
    //   for (let c = 0; c < this.resolution; c++) {
    //     fixed[c * this.resolution + (this.resolution - 1 - r)] = 
    //       this.heights[r * this.resolution + c];
    //   }
    // }
    const fixed = new Float32Array(this.heights.length);
    for (let r = 0; r < this.resolution; r++) {
      for (let c = 0; c < this.resolution; c++) {
        fixed[(this.resolution - 1 - r) * this.resolution + c] = 
          this.heights[r * this.resolution + c];
      }
    }

    const desc = this.RAPIER.ColliderDesc.heightfield(
      this.resolution - 1,
      this.resolution - 1,
      fixed,
      new this.RAPIER.Vector3(this.spanX, 1.0, this.spanZ)
    )
      .setRestitution(0.35)
      .setFriction(0.8);

    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed().setTranslation(
        this.bounds.minX + this.spanX / 2,
        0,
        this.bounds.minZ + this.spanZ / 2
      )
    );

    this.collider = this.world.createCollider(desc, body);
    return this.collider;
  }
  ___createCollider() {

    // Find the actual range of your height data
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      if (this.heights[i] < minH) minH = this.heights[i];
      if (this.heights[i] > maxH) maxH = this.heights[i];
    }
    const midH = (minH + maxH) / 2;
    console.log('Height range:', minH, 'to', maxH, 'mid:', midH);

    // Transpose heights — Rapier's row/col convention is opposite ours
    const transposed = new Float32Array(this.heights.length);
    for (let r = 0; r < this.resolution; r++) {
      for (let c = 0; c < this.resolution; c++) {
        transposed[c * this.resolution + r] = this.heights[r * this.resolution + c];
      }
    }

    const desc = this.RAPIER.ColliderDesc.heightfield(
      this.resolution - 1,
      this.resolution - 1,
      transposed,
      new this.RAPIER.Vector3(this.spanX, 1.0, this.spanZ)
      // new this.RAPIER.Vector3(this.spanZ, 1.0, this.spanX)  // swapped

    )
    .setRestitution(0.35)
    .setFriction(0.8);

    const body = this.world.createRigidBody(
      this.RAPIER.RigidBodyDesc.fixed().setTranslation(
        this.bounds.minX + this.spanX / 2,
        0,
        this.bounds.minZ + this.spanZ / 2
      )
    );

    this.collider = this.world.createCollider(desc, body);
    return this.collider;
  }

  getHeight(x, z) {
    const u = ((x - this.bounds.minX) / this.spanX) * (this.resolution - 1);
    const v = ((z - this.bounds.minZ) / this.spanZ) * (this.resolution - 1);

    const c0 = Math.floor(u), c1 = Math.min(c0 + 1, this.resolution - 1);
    const r0 = Math.floor(v), r1 = Math.min(r0 + 1, this.resolution - 1);
    const fu = u - c0, fv = v - r0;

    const h00 = this.heights[r0 * this.resolution + c0];
    const h10 = this.heights[r0 * this.resolution + c1];
    const h01 = this.heights[r1 * this.resolution + c0];
    const h11 = this.heights[r1 * this.resolution + c1];

    return h00 * (1 - fu) * (1 - fv) + h10 * fu * (1 - fv)
         + h01 * (1 - fu) * fv       + h11 * fu * fv;
  }

  getNormal(x, z, target = new THREE.Vector3()) {
    const eps = this.spanX / this.resolution;
    const hL = this.getHeight(x - eps, z);
    const hR = this.getHeight(x + eps, z);
    const hD = this.getHeight(x, z - eps);
    const hU = this.getHeight(x, z + eps);
    return target.set(hL - hR, 2 * eps, hD - hU).normalize();
  }

  createRapierDebugMesh(step = 8) {
    // Force broadphase update so raycasts work
    this.world.step();

    const cols = Math.floor(this.resolution / step);
    const rows = Math.floor(this.resolution / step);
    const positions = new Float32Array(cols * rows * 3);
    const indices = [];

    let misses = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = this.bounds.minX + (c / (cols - 1)) * this.spanX;
        const z = this.bounds.minZ + (r / (rows - 1)) * this.spanZ;

        const ray = new this.RAPIER.Ray(
          new this.RAPIER.Vector3(x, 500, z),
          new this.RAPIER.Vector3(0, -1, 0)
        );

        const hit = this.world.castRay(ray, 1000, true);
        const y = hit ? 500 - hit.timeOfImpact : 0;
        if (!hit) misses++;

        const idx = (r * cols + c) * 3;
        positions[idx]     = x;
        positions[idx + 1] = y;
        positions[idx + 2] = z;
      }
    }

    console.log(`Rapier debug mesh: ${cols}x${rows}, ${misses} ray misses`);

    // Compare data vs rapier at random points
    for (let i = 0; i < 20; i++) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      const idx = (r * cols + c) * 3;
      const x = positions[idx], z = positions[idx + 2];
      const rapierY = positions[idx + 1];
      const dataY = this.getHeight(x, z);
      console.log(`Sample (${x.toFixed(1)}, ${z.toFixed(1)}):`,
        'data:', dataY.toFixed(3),
        'rapier:', rapierY.toFixed(3),
        'diff:', (rapierY - dataY).toFixed(3)
      );
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = r * cols + c;
        indices.push(tl, tl + cols, tl + 1);
        indices.push(tl + 1, tl + cols, tl + cols + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        wireframe: true, color: 0xff0000, transparent: true, opacity: 0.5
      })
    );

    this.rapierDebugMesh = mesh;
    return mesh;
  }
  debugCollider(x, z) {
    const ray = new this.RAPIER.Ray(
      new this.RAPIER.Vector3(x, 1000, z),
      new this.RAPIER.Vector3(0, -1, 0)
    );

    const hit = this.world.castRay(ray, 2000, true);
    const rapierY = hit ? 1000 - hit.timeOfImpact : null;
    const ourY = this.getHeight(x, z);

    console.log(`At (${x.toFixed(1)}, ${z.toFixed(1)}):`,
      'getHeight:', ourY?.toFixed(2),
      'Rapier ray:', rapierY?.toFixed(2),
      'diff:', rapierY ? (rapierY - ourY).toFixed(2) : 'no hit'
    );
  }

  // createRapierDebugMesh() {
  //   const vertices = this.collider.vertices();
  //   const indices = this.collider.indices();

  //   if (!vertices || !indices) {
  //     console.warn('Rapier version does not expose vertices/indices');
  //     return null;
  //   }

  //   const geometry = new THREE.BufferGeometry();
  //   geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  //   geometry.setIndex(new THREE.Uint32BufferAttribute(indices, 1));

  //   const bodyPos = this.collider.parent().translation();

  //   const mesh = new THREE.Mesh(
  //     geometry,
  //     new THREE.MeshNormalMaterial({ wireframe: true, side: THREE.DoubleSide })
  //   );

  //   // Rapier vertices are in body-local space
  //   mesh.position.set(bodyPos.x, bodyPos.y, bodyPos.z);

  //   this.rapierDebugMesh = mesh;
  //   return mesh;
  // }
  
  createDebugMesh(step = 8) {
    const cols = Math.floor(this.resolution / step);
    const rows = Math.floor(this.resolution / step);
    const positions = new Float32Array(cols * rows * 3);
    const indices = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols + c) * 3;
        positions[idx]     = this.bounds.minX + (c / (cols - 1)) * this.spanX;
        positions[idx + 1] = this.heights[(r * step) * this.resolution + (c * step)];
        positions[idx + 2] = this.bounds.minZ + (r / (rows - 1)) * this.spanZ;
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const tl = r * cols + c;
        indices.push(tl, tl + cols, tl + 1);
        indices.push(tl + 1, tl + cols, tl + cols + 1);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ wireframe: true, color: 0xaaaaff })
    );

    this.debugMesh = mesh;
    return mesh;
  }

  removeDebugMesh() {
    if (this.debugMesh) {
      this.debugMesh.geometry.dispose();
      this.debugMesh.material.dispose();
      this.debugMesh.removeFromParent();
      this.debugMesh = null;
    }
  }
}

export class GroundPhysics {
  constructor(mesh, world, RAPIER, options = {}) {
    this.options = { restitution: 0.05, friction: 0.4, ...options };
    this.mesh = mesh;
    this.world = world;
    this.RAPIER = RAPIER;

    const geo = mesh.geometry;
    // Extract vertices and indices
    const posAttr = geo.getAttribute('position');
    // const vertices = new Float32Array(posAttr.array);
    const tmp = new THREE.Vector3();

    // Apply the mesh's world transform to the vertices
    mesh.updateMatrixWorld(true);
    // Bake world-space vertices
    const vertices = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
      vertices[i * 3]     = tmp.x;
      vertices[i * 3 + 1] = tmp.y;
      vertices[i * 3 + 2] = tmp.z;
    }

    // Indices (generate sequential ones if the geometry is non-indexed)
    let indices;
    if (geo.index) {
      indices = new Uint32Array(geo.index.array);
    } else {
      indices = new Uint32Array(posAttr.count);
      for (let i = 0; i < indices.length; i++) indices[i] = i;
    }

    // const matrix = mesh.matrixWorld;
    // const v = new THREE.Vector3();
    // for (let i = 0; i < vertices.length; i += 3) {
    //   v.set(vertices[i], vertices[i + 1], vertices[i + 2]);
    //   v.applyMatrix4(matrix);
    //   vertices[i] = v.x;
    //   vertices[i + 1] = v.y;
    //   vertices[i + 2] = v.z;
    // }

    // let indices;
    // if (geo.index) {
    //   indices = new Uint32Array(geo.index.array);
    // } else {
    //   // Non-indexed: generate sequential indices
    //   indices = new Uint32Array(posAttr.count);
    //   for (let i = 0; i < posAttr.count; i++) indices[i] = i;
    // }

    const desc = this.RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(this.options.restitution)
      .setFriction(this.options.friction);

    this.collider = this.world.createCollider(desc);
    this.collider.userData = this.options;
  }

}