import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import { seededRandom } from '@/utils/random';
import { isMeshObject } from '@/utils/mesh';
import { GROUP_BALL, GROUP_OBJECT } from './physics/ballPhysics';
import { GroundUtils } from './physics/groundPhysics';
import { QualityMode } from './utils/quality';

export type TreePlanterOptions = {
  groundMeshes?: THREE.Object3D | THREE.Object3D[];
  scene: THREE.Group;
  worldSize: number;
  world?: World;
  rapier?: RapierInstance;
  qualityLevel?: QualityMode;
};

export type TreeGroup = {
  meshGroup: THREE.Group;
  scaleRange: {
    min: number,
    max: number
  },
  density: number,
  minDistance?: number,
  colors: number[],
  collider?: {
    radius: number,
    height: number
  },
  // collider?: boolean,
  lodDistances: number[],
};

type LODEntry = {
  allMatrices: THREE.Matrix4[];
  allColors: number[];
  lodMeshes: THREE.InstancedMesh[][]; // lodMeshes[0] = LOD0 meshes, [1] = LOD1, etc.
  lodDistances: number[];
};

class SpatialHash2D {
  private cellSize: number;
  private cells = new Map<string, { x: number; z: number }[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`;
  }

  insert(x: number, z: number) {
    const k = this.key(x, z);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k)!.push({ x, z });
  }

  hasNeighborWithin(x: number, z: number, minDist: number): boolean {
    const r = Math.ceil(minDist / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const dSq = minDist * minDist;

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const pts = this.cells.get(`${cx + dx},${cz + dz}`);
        if (!pts) continue;
        for (const p of pts) {
          if ((p.x - x) ** 2 + (p.z - z) ** 2 < dSq) return true;
        }
      }
    }
    return false;
  }
}

export class TreePlanter {
  scene: THREE.Group;
  worldSize: number;
  world?: World;
  rapier?: RapierInstance;
  physicsEnabled: boolean;
  groundMeshes: THREE.Object3D | THREE.Object3D[];
  qualityLevel?: QualityMode;
  treeGroup: THREE.Group;
  #raycaster: THREE.Raycaster;
  lodEntries: LODEntry[] = [];
  #init: boolean = false;
  #frameNum = 0;

  constructor(options: TreePlanterOptions) {
    const { scene, worldSize, groundMeshes, world, rapier } = options;
    this.scene = scene;
    this.worldSize = worldSize;
    this.world = world ?? undefined;
    this.rapier = rapier ?? undefined;
    this.physicsEnabled = !!(this.world && this.rapier);
    this.qualityLevel = options.qualityLevel;
    
    // Normalise groundMeshes to an array
    this.groundMeshes = groundMeshes
      ? (Array.isArray(groundMeshes) ? groundMeshes : [groundMeshes])
      : [];

    // Three.js raycaster used when RAPIER isn't available (or always for Y)
    this.#raycaster = new THREE.Raycaster();
    // this.#raycaster.firstHitOnly = true; // requires three-mesh-bvh or r152+

    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
  }

  get hasPhysics() {
    return this.physicsEnabled;
  }

  clear() {
    this.scene.remove(this.treeGroup);
    this.treeGroup = new THREE.Group();
    // this.lods = [];
    this.scene.add(this.treeGroup);
  }

  #getGroundY(x: number, z: number) {
    const originY = 200;

    if (this.physicsEnabled) {
      const ray = new this.rapier!.Ray(
        { x, y: originY, z },
        { x: 0, y: -1, z: 0 }
      );
      const hit = this.world!.castRay(ray, 500, true);
      if (hit == null) {
        console.log('No ground hit...');
        return null;
      }
      return originY - hit.timeOfImpact;
    }

    // Three.js fallback
    if (!this.groundMeshes || Array.isArray(this.groundMeshes) && this.groundMeshes?.length === 0) return 0; // no ground info, plant at y=0

    this.#raycaster.set(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = this.#raycaster.intersectObjects(this.groundMeshes as THREE.Object3D[], true);
    if (hits.length === 0) return null;
    return hits[0].point.y;
  }
  // #getGroundY(x: number, z: number) {
  //   if (!this.groundMeshes || (Array.isArray(this.groundMeshes) && this.groundMeshes.length === 0)) {
  //     return 0;
  //   }

  //   const result = GroundUtils.getGroundYFromScene(this.groundMeshes, x, z);
  //   return result?.y ?? null;
  // }


  /**
   * Optionally create a physics collider for a planted tree.
   * No-ops when physics aren't available.
   */
  _addCollider(pos: THREE.Vector3, scale: number, baseHeight: number, baseRadius: number, userData: any) {
    if (!this.physicsEnabled) return;

    // const RAPIER = this.RAPIER;
    const s = scale;
    const bodyDesc = this.rapier!.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y + (baseHeight * s) / 2, pos.z);
    const body = this.world!.createRigidBody(bodyDesc);
    const colliderDesc = this.rapier!.ColliderDesc.cylinder(
      (baseHeight * s) / 2,
      baseRadius * s
    );
    const collider = this.world!.createCollider(colliderDesc, body);
    // @ts-expect-error
    collider.userData = userData;
    collider.setCollisionGroups(
      (GROUP_OBJECT << 16) | GROUP_BALL
    );

  }

  plantFromMask(trees: TreeGroup[], maskData: { data: ImageDataArray, width: number, height: number }, seed = 12345) {
    const { data, width, height } = maskData;
    const cellW = this.worldSize / width;
    const cellH = this.worldSize / height;
    const random = seededRandom(seed);

    const totalDensity = trees.reduce((sum, t) => sum + t.density, 0);

    const cumulativeWeights = [];
    let cumSum = 0;
    for (const t of trees) {
      cumSum += t.density / totalDensity;
      cumulativeWeights.push(cumSum);
    }
    cumulativeWeights[cumulativeWeights.length - 1] = 1.0;

    // Phase 1: scatter XZ from mask
    const scattered: { x: number, z: number }[][] = trees.map(() => []);
    // const grids = trees.map((t) => {
    //   console.log('config-grid', t);
    //   return t.minDistance ? new SpatialHash2D(t.minDistance) : null
    // });
    const sharedGrid = new SpatialHash2D(
      Math.min(...trees.map(t => t.minDistance ?? Infinity)) || 1
    );
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const val = data[(py * width + px) * 4];
        if (val === 0) continue;

        const cellDensity = (val / 255) * totalDensity;
        const count = Math.floor(cellDensity);
        const extra = random() < (cellDensity - count) ? 1 : 0;

        for (let t = 0; t < count + extra; t++) {
          const r = random();
          let treeIdx = 0;
          for (let i = 0; i < cumulativeWeights.length; i++) {
            if (r <= cumulativeWeights[i]) { treeIdx = i; break; }
          }

          const x = (px + random()) * cellW;
          const z = (py + random()) * cellH;

          // ── min-distance check against ALL placed trees ──
          const minDist = trees[treeIdx].minDistance;
          if (minDist) {
            if (sharedGrid.hasNeighborWithin(x, z, minDist)) {
              continue;
            }
          }

          sharedGrid.insert(x, z);  // register for ALL groups to see
          scattered[treeIdx].push({ x, z });
        }
      }
    }
    

    // for (let py = 0; py < height; py++) {
    //   for (let px = 0; px < width; px++) {
    //     const val = data[(py * width + px) * 4];
    //     if (val === 0) continue;

    //     const cellDensity = (val / 255) * totalDensity;
    //     const count = Math.floor(cellDensity);
    //     const extra = random() < (cellDensity - count) ? 1 : 0;

    //     for (let t = 0; t < count + extra; t++) {
    //       const r = random();
    //       let treeIdx = 0;
    //       for (let i = 0; i < cumulativeWeights.length; i++) {
    //         if (r <= cumulativeWeights[i]) { treeIdx = i; break; }
    //       }
    //       scattered[treeIdx].push({
    //         x: (px + random()) * cellW,
    //         z: (py + random()) * cellH,
    //       });
    //     }
    //   }
    // }

    // Phase 2: raycast for Y + build matrices per tree type
    const dummy = new THREE.Object3D();
    const allResults = [];

    for (let treeIdx = 0; treeIdx < trees.length; treeIdx++) {
      const { meshGroup, scaleRange, colors, collider: wantColliders } = trees[treeIdx];

      const box = new THREE.Box3().setFromObject(meshGroup);
      const treeSize = box.getSize(new THREE.Vector3());
      const baseHeight = treeSize.y * 0.75;
      const baseRadius = Math.min(treeSize.x, treeSize.z) / 18;

      const points = scattered[treeIdx];
      if (points.length === 0) { allResults.push(null); continue; }

      const matrices: THREE.Matrix4[] = [];
      for (const { x, z } of points) {
        const y = this.#getGroundY(x, z);
        if (y == null) continue;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, random() * Math.PI * 2, 0);
        const s = scaleRange.min + random() * (scaleRange.max - scaleRange.min);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }

      if (matrices.length === 0) { allResults.push(null); continue; }

      // Colliders (only when physics available AND tree config opts in)
      if (wantColliders) {
        const pos = new THREE.Vector3();
        const scale = new THREE.Vector3();
        const quat = new THREE.Quaternion();

        for (let i = 0; i < matrices.length; i++) {
          matrices[i].decompose(pos, quat, scale);
          this._addCollider(pos, scale.x, baseHeight, baseRadius, {
            type: 'tree',
            treeIdx,
          });
        }
      }


      const count = matrices.length;
      const color = new THREE.Color();
      const pickedColors = colors?.length > 0
        ? Array.from({ length: count }, () => colors[Math.floor(random() * colors.length)])
        : [];

      
      const meshes = this.#buildLODMeshes(trees[treeIdx], matrices, pickedColors, count);
      allResults.push(meshes);
    }
    return allResults;
  }

  #splitByLODLevel(meshGroup: THREE.Group): Map<number, THREE.Group> {
    const levels = new Map<number, THREE.Group>();

    meshGroup.children.forEach((child) => {
      const level = child.userData?.lod ?? 0;
      if (!levels.has(level)) {
        levels.set(level, new THREE.Group());
      }
      levels.get(level)!.add(child.clone());
    });

    for (const group of levels.values()) {
      group.applyMatrix4(meshGroup.matrixWorld);
    }

    return levels;
  }

  #buildLODMeshes(
    treeConfig: TreeGroup,
    matrices: THREE.Matrix4[],
    pickedColors: number[],
    count: number
  ) {
    const { meshGroup, lodDistances } = treeConfig;
    const levels = this.#splitByLODLevel(meshGroup);
    const color = new THREE.Color();
    const maxLevel = Math.max(...levels.keys());

    const lodMeshes: THREE.InstancedMesh[][] = [];

    for (const [level, sourceGroup] of [...levels.entries()].sort((a, b) => a[0] - b[0])) {
      const meshes: THREE.InstancedMesh[] = [];

      sourceGroup.children.forEach((child) => {
        if (!isMeshObject(child)) return;

        const geo = child.geometry.clone();
        child.updateWorldMatrix(true, false);
        const localMatrix = new THREE.Matrix4();
        localMatrix.copy(sourceGroup.matrixWorld).invert().multiply(child.matrixWorld);
        geo.applyMatrix4(localMatrix);

        geo.computeBoundingBox();

        // @ts-expect-error
        const instanced = new THREE.InstancedMesh(geo, child.material.clone(), count);

        if (level === maxLevel) {
          const mat = instanced.material as THREE.Material;
          mat.alphaTest = 0.0;
          mat.alphaToCoverage = true;
          mat.transparent = false;
          mat.depthWrite = true;
          mat.side = THREE.DoubleSide;
        }

        instanced.instanceMatrix.needsUpdate = true;
        instanced.castShadow = level !== maxLevel;
        instanced.receiveShadow = false;
        instanced.frustumCulled = false;

        this.treeGroup.add(instanced);
        meshes.push(instanced);
      });

      lodMeshes.push(meshes);
    }

    this.lodEntries.push({
      allMatrices: matrices,
      allColors: pickedColors,
      lodMeshes,
      lodDistances,
    });

    return lodMeshes.flat();
  }

  static loadTree(tree: THREE.Object3D) {

    const treeGroup = new THREE.Group();
    tree.scale.set(1, 1, 1);
    tree.updateMatrixWorld(true);

    // Find the node that contains the LOD groups
    let lodParent: THREE.Object3D | null = null;
    tree.traverse((child) => {
      if (child.children.some(c => c.userData?.lod_level !== undefined || c.name.match(/^LOD\d+$/))) {
        lodParent = child;
      }
    });

    if (lodParent) {
      // Multi-LOD tree
      for (const lodNode of (lodParent as THREE.Object3D).children) {
        const level = lodNode.userData?.lod_level ?? parseInt(lodNode.name.match(/LOD(\d+)/i)?.[1] ?? '0');

        if (lodNode instanceof THREE.Mesh) {
          const mesh = lodNode.clone();
          lodNode.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.userData.lod = level;
          treeGroup.add(mesh);
        } else {
          lodNode.traverse((child) => {
            if (child instanceof THREE.Mesh && child.isMesh) {
              const mesh = child.clone();
              child.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
              mesh.userData.lod = level;
              treeGroup.add(mesh);
            }
          });
        }
      }
    } else {
      // Single mesh, no LODs — treat everything as LOD0
      tree.traverse((child) => {
        if (child instanceof THREE.Mesh && child.isMesh) {
          const mesh = child.clone();
          child.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
          mesh.userData.lod = 0;
          treeGroup.add(mesh);
        }
      });
    }

    // Center at origin
    const box = new THREE.Box3().setFromObject(treeGroup);
    const center = box.getCenter(new THREE.Vector3());
    treeGroup.children.forEach((child) => {
      child.position.x -= center.x;
      child.position.z -= center.z;
      child.position.y -= Math.max(0, box.min.y);  // only shift DOWN if model floats above origin
      // child.position.y -= box.min.y;
    });

    return treeGroup;
  }
  
  #updateLODs(camera: THREE.Camera) {
    const camPos = camera.position;
    const pos = new THREE.Vector3();

    for (const entry of this.lodEntries) {
      const { allMatrices, lodMeshes, lodDistances } = entry;
      const distsSq = lodDistances.map(d => d * d);
      if (!lodMeshes.length) { return; }
      const counts = new Array(lodMeshes.length).fill(0);

      for (let i = 0; i < allMatrices.length; i++) {
        pos.setFromMatrixPosition(allMatrices[i]);
        const d = (pos.x - camPos.x) ** 2 + (pos.z - camPos.z) ** 2;

        // Find which LOD level this instance belongs to
        let level = 0;
        for (let l = 0; l < distsSq.length; l++) {
          if (d >= distsSq[l]) {
            level = l + 1;
          }
        }
        // Clamp to max available level
        level = Math.min(level, lodMeshes.length - 1);
        const meshes = lodMeshes?.[level] || [];
        for (const mesh of meshes) {
          mesh.setMatrixAt(counts[level], allMatrices[i]);
        }
        counts[level]++;
      }
      // console.log(`level: ${level}`);

      for (let l = 0; l < lodMeshes.length; l++) {
        for (const mesh of lodMeshes[l]) {
          mesh.count = counts[l];
          mesh.instanceMatrix.needsUpdate = true;
        }
      }
    }

  }
  update(camera: THREE.Camera, isShotActive: boolean) {
    // if (camera && (!this.#init || isShotActive)) {
    //   this.#init = true;
    //   this.#updateLODs(camera);
    // }
    this.#frameNum++;
    if (this.#frameNum % 4 === 0) {
      this.#updateLODs(camera);
    }
  }

  
}
