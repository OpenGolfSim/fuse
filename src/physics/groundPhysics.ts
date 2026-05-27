import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import { ColliderWithUserData } from '@/physics/constants';
import { GROUP_BALL, GROUP_TERRAIN } from '@/physics/ballPhysics';

const _raycaster = new THREE.Raycaster();
const _origin = new THREE.Vector3();
const _direction = new THREE.Vector3(0, -1, 0);

type GroundPhysicsOptions = {
  friction: number,
  restitution: number,
  rollResistance: number
}

export class GroundPhysics {
  mesh: THREE.Mesh;
  world: World;
  rapier: RapierInstance;
  options: GroundPhysicsOptions = {
    friction: 0.4,
    restitution: 0.4,
    rollResistance: 0.15
  }
  collider: ColliderWithUserData;

  constructor(mesh: THREE.Mesh, world: World, rapier: RapierInstance, options: GroundPhysicsOptions) {
    this.options = { ...this.options, ...(options || {}) };
    
    this.mesh = mesh;
    this.world = world;
    this.rapier = rapier;

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
    const desc = this.rapier.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(this.options.restitution)
      .setFriction(this.options.friction);

      
    this.collider = this.world.createCollider(desc);
    this.collider.setCollisionGroups(
      (GROUP_TERRAIN << 16) | GROUP_BALL  // member of TERRAIN, interacts with BALL
    );
    this.collider.userData = this.options;
  }

}

export class GroundUtils {
  static getGroundYFromScene(
    groundMeshes: THREE.Object3D | THREE.Object3D[],
    x: number,
    z: number,
    startY = 1000,
    maxDistance = 1000
  ) {
    _origin.set(x, startY, z);
    _raycaster.set(_origin, _direction);
    _raycaster.far = maxDistance;

    // Normalize to array — a Scene/Group works great here with recursive=true
    const targets = Array.isArray(groundMeshes) ? groundMeshes : [groundMeshes];
    const recursive = !Array.isArray(groundMeshes); // auto-recurse when given a root
    const hits = _raycaster.intersectObjects(targets, recursive);
    if (hits.length > 0) {
      const hit = hits[0];
      return { y: hit.point.y, object: hit.object };
    }
    return null;
  }

  static getGroundY(rapierInstance: RapierInstance, world: World, x: number, z: number, startY = 1000, maxDistance = 2000) {
    const origin = { x, y: startY, z };
    const direction = { x: 0, y: -1, z: 0 };

    const ray = new rapierInstance.Ray(origin, direction);

    const solid = true; // treat colliders as solid (hit on entry)
    const hit = world.castRay(ray, maxDistance, solid);
    if (hit !== null) {
      // Distance along the ray to the hit point
      const hitY = startY + direction.y * hit.timeOfImpact;
      const collider = hit.collider; // the Collider that was hit
      return { y: hitY, collider };
    }
    return null;
  }
}