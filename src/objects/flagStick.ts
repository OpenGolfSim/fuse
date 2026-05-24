import * as THREE from 'three';

// Simple Verlet particle
class FlagParticle {
  position: THREE.Vector3;
  previous: THREE.Vector3;
  acceleration: THREE.Vector3;
  mass: number;
  invMass: number;
  pinned = false;

  constructor(x: number, y: number, z: number, mass: number) {
    this.position = new THREE.Vector3(x, y, z);
    this.previous = new THREE.Vector3(x, y, z);
    this.acceleration = new THREE.Vector3();
    this.mass = mass;
    this.invMass = 1 / mass;
  }

  applyForce(force: THREE.Vector3Like) {
    // F = ma, a = F/m
    this.acceleration.addScaledVector(force, this.invMass);
  }

  integrate(dt: number) {
    if (this.pinned) return;
    
    this.previous.lerp(this.position, 0.12);

    // Verlet integration: new_pos = 2*pos - prev + acc*dt²
    const dtSq = dt * dt;
    const nx = 2 * this.position.x - this.previous.x + this.acceleration.x * dtSq;
    const ny = 2 * this.position.y - this.previous.y + this.acceleration.y * dtSq;
    const nz = 2 * this.position.z - this.previous.z + this.acceleration.z * dtSq;

    this.previous.copy(this.position);
    this.position.set(nx, ny, nz);
    this.acceleration.set(0, 0, 0);
  }
}

// Distance constraint between two particles
class FlagConstraint {
  p1: FlagParticle;
  p2: FlagParticle;
  restLength: number;

  constructor(p1: FlagParticle, p2: FlagParticle) {
    this.p1 = p1;
    this.p2 = p2;
    this.restLength = p1.position.distanceTo(p2.position);
  }

  satisfy() {
    const diff = new THREE.Vector3().subVectors(this.p2.position, this.p1.position);
    const dist = diff.length();
    if (dist === 0) return;

    const correction = diff.multiplyScalar((dist - this.restLength) / dist * 0.5);

    if (!this.p1.pinned) this.p1.position.add(correction);
    if (!this.p2.pinned) this.p2.position.sub(correction);
  }
}

/**
 * Creates a simple flag stick with cloth simulation
 */
export class FlagStick {
  object: THREE.Group;
  holeNumber: number;
  elapsed = 0;
  particles: FlagParticle[];
  constraints: FlagConstraint[];
  segsX: number;
  segsY: number;
  gravity: THREE.Vector3;
  windForce: THREE.Vector3;
  flag: THREE.Mesh;
  stick: THREE.Mesh;
  
  #tmpForce: THREE.Vector3;
  #restPositions: THREE.TypedArray;

  constructor(position: THREE.Vector3, holeNumber: number) {
    this.object = new THREE.Group();
    this.holeNumber = holeNumber;

    const stickHeight = 2.13;
    const flagWidth = 0.45;
    const flagHeight = 0.3;
    const segsX = 15;
    const segsY = 10;

    this.particles = [];
    this.constraints = [];
    this.segsX = segsX;
    this.segsY = segsY;

    // const gravity = new THREE.Vector3(0, -9.8, 0);
    // this.gravity = gravity;
    this.gravity = new THREE.Vector3(0, -2.0, 0);
    this.windForce = new THREE.Vector3();
    this.#tmpForce = new THREE.Vector3();

    // Create particles in a grid
    for (let y = 0; y <= segsY; y++) {
      for (let x = 0; x <= segsX; x++) {
        const px = (x / segsX) * flagWidth;
        const py = -(y / segsY) * flagHeight;
        const p = new FlagParticle(px, py, 0, 0.1);

        // Pin the left column (attached to the pole)
        if (x === 0) p.pinned = true;

        this.particles.push(p);
      }
    }

    // Structural constraints (horizontal + vertical neighbors)
    for (let y = 0; y <= segsY; y++) {
      for (let x = 0; x <= segsX; x++) {
        const i = y * (segsX + 1) + x;
        if (x < segsX) this.constraints.push(new FlagConstraint(this.particles[i], this.particles[i + 1]));
        if (y < segsY) this.constraints.push(new FlagConstraint(this.particles[i], this.particles[i + segsX + 1]));
      }
    }

    // Shear constraints (diagonal neighbors for stability)
    for (let y = 0; y < segsY; y++) {
      for (let x = 0; x < segsX; x++) {
        const i = y * (segsX + 1) + x;
        this.constraints.push(new FlagConstraint(this.particles[i], this.particles[i + segsX + 2]));
        this.constraints.push(new FlagConstraint(this.particles[i + 1], this.particles[i + segsX + 1]));
      }
    }
    // Bend constraints (skip one particle — resists folding)
    for (let y = 0; y <= segsY; y++) {
      for (let x = 0; x <= segsX; x++) {
        const i = y * (segsX + 1) + x;
        if (x < segsX - 1) this.constraints.push(new FlagConstraint(this.particles[i], this.particles[i + 2]));
        if (y < segsY - 1) this.constraints.push(new FlagConstraint(this.particles[i], this.particles[i + (segsX + 1) * 2]));
      }
    }
    
    // Flag mesh
    const flagGeometry = new THREE.PlaneGeometry(flagWidth, flagHeight, segsX, segsY);
    const flagMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, side: THREE.DoubleSide });
    this.flag = new THREE.Mesh(flagGeometry, flagMaterial);
    this.flag.position.set(flagWidth / 2, stickHeight - flagHeight / 2, 0);
    this.flag.castShadow = true;

    // Store rest positions so we can map particle offsets onto the geometry
    this.#restPositions = flagGeometry.attributes.position.array.slice();

    // Pole mesh
    const stickGeometry = new THREE.CylinderGeometry(0.02, 0.02, stickHeight, 32);
    const stickMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
    this.stick = new THREE.Mesh(stickGeometry, stickMaterial);
    this.stick.position.set(0, stickHeight / 2, 0);
    this.stick.castShadow = true;

    this.object.add(this.flag);
    this.object.add(this.stick);
    this.object.position.copy(position);
    this.object.name = `FlagStick${this.holeNumber}`
  }

  update(dt: number) {
    if (!dt || isNaN(dt)) return;
    this.elapsed += dt;

    // Use a fixed timestep for simulation stability
    const simStep = 1 / 60;
    const steps = Math.min(Math.floor(dt / simStep), 2);

    for (let s = 0; s < steps; s++) {

      // Wind — varies with noise so it's not uniform across the flag
      for (const p of this.particles) {
        p.applyForce(this.gravity);

        if (!p.pinned) {
          const noiseX = Math.sin(this.elapsed * 0.8 + p.position.x * 4 + p.position.y * 3) * 0.5 + 0.5;
          this.#tmpForce.set(0, 0, 0.3 + noiseX * 0.4);
          p.applyForce(this.#tmpForce);
        }
      }

      // Integrate
      for (const p of this.particles) {
        p.integrate(simStep);
      }

      // Satisfy constraints (multiple iterations = stiffer cloth)
      for (let i = 0; i < 3; i++) {
        for (const c of this.constraints) {
          c.satisfy();
        }
      }
    }

    // Map particle positions onto the Three.js geometry
    const pos = this.flag.geometry.attributes.position;
    const rest = this.#restPositions;

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      // PlaneGeometry center is at (0,0), particles start at (0,0)
      // Offset so particle (0,0) maps to geometry's top-left corner
      pos.array[i * 3]     = rest[i * 3]     + (p.position.x - (this.#restPositions[i * 3] + this.segsX > 0 ? 0 : 0));
      pos.array[i * 3 + 1] = rest[i * 3 + 1] + (p.position.y + ((this.segsY * 0.5) / this.segsY) * (this.particles[i].pinned ? 0 : 1));
      pos.array[i * 3 + 2] = p.position.z;
    }

    // Simpler and more correct: just copy particle positions directly
    // The geometry vertices and particles are in the same grid order
    const halfW = 0.45 / 2;
    const halfH = 0.3 / 2;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      pos.array[i * 3]     = p.position.x - halfW;
      pos.array[i * 3 + 1] = p.position.y + halfH;
      pos.array[i * 3 + 2] = p.position.z;
    }

    pos.needsUpdate = true;
    this.flag.geometry.computeVertexNormals();
  }
}