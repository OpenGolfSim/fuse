import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { type World } from '@dimforge/rapier3d-compat';
import { seededRandom } from '@/utils/random';
import { isMeshObject } from '@/utils/mesh';
import { GROUP_BALL, GROUP_OBJECT } from './physics/ballPhysics';
// import { GroundUtils } from './physics/groundPhysics';
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
  maxDistance?: number,
};

type BatchEntry = {
  mesh: THREE.BatchedMesh;
  lodGeometryIds: number[];   // index = LOD level; -1 = no geometry at that level
  instanceIds: number[];      // index = planted tree
};

type LODEntry = {
  batches: BatchEntry[];
  allMatrices: THREE.Matrix4[];
  positions: Float32Array;    // XZ per planted tree
  cullRadius: number;         // approx tree bounding radius for frustum test
  lodDistances: number[];
  maxDistance: number;
  currentLevel: Uint8Array;   // per planted tree
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
  #lastCamX = 0;
  #lastCamZ = 0;  
  #lastCamDir = new THREE.Vector3();
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

    // if (this.physicsEnabled) {
    //   const ray = new this.rapier!.Ray(
    //     { x, y: originY, z },
    //     { x: 0, y: -1, z: 0 }
    //   );
    //   const hit = this.world!.castRay(ray, 500, true);
    //   if (hit == null) {
    //     console.log('No ground hit...');
    //     return null;
    //   }
    //   return originY - hit.timeOfImpact;
    // }

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

    // Scatter XZ from mask
    const scattered: { x: number, z: number }[][] = trees.map(() => []);
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

    // Raycast for Y + build matrices per tree type
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
      // if (wantColliders) {
      //   const pos = new THREE.Vector3();
      //   const scale = new THREE.Vector3();
      //   const quat = new THREE.Quaternion();

      //   for (let i = 0; i < matrices.length; i++) {
      //     matrices[i].decompose(pos, quat, scale);
      //     this._addCollider(pos, scale.x, baseHeight, baseRadius, {
      //       type: 'tree',
      //       treeIdx,
      //     });
      //   }
      // }


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
    // const color = new THREE.Color();
    const maxLevel = Math.max(...levels.keys());

    // Group submeshes by material across ALL LOD levels.
    // One BatchedMesh per unique material — any texture layout works.
    const groups = new Map<string, { material: THREE.Material, perLevel: THREE.BufferGeometry[][] }>();
    for (const [level, sourceGroup] of levels.entries()) {
      sourceGroup.children.forEach((child) => {
        if (!isMeshObject(child)) return;

        const geo = child.geometry.clone();
        child.updateWorldMatrix(true, false);
        const localMatrix = new THREE.Matrix4();
        localMatrix.copy(sourceGroup.matrixWorld).invert().multiply(child.matrixWorld);
        geo.applyMatrix4(localMatrix);

        const mat = child.material as THREE.Material;
        let g = groups.get(mat.uuid);
        if (!g) {
          g = { material: mat, perLevel: Array.from({ length: maxLevel + 1 }, () => []) };
          groups.set(mat.uuid, g);
        }
        g.perLevel[level].push(geo);
      });
    }

    const batches: BatchEntry[] = [];
    for (const { material, perLevel } of groups.values()) {
      // Merge same-material submeshes within each LOD level into one geometry
      const lodGeos = perLevel.map(list =>
        list.length === 0 ? null : list.length === 1 ? list[0] : mergeGeometries(list)
      );

      // Any material used at the billboard level gets cutout settings
      const hasBillboard = lodGeos[maxLevel] !== null;
      if (hasBillboard) {
        material.alphaTest = 0.0;
        (material as any).alphaToCoverage = true;
        material.transparent = false;
        material.depthWrite = true;
      }

      let maxVerts = 0;
      let maxIndices = 0;
      for (const g of lodGeos) {
        if (!g) continue;
        maxVerts += g.attributes.position.count;
        maxIndices += g.index ? g.index.count : g.attributes.position.count;
      }

      // const batched = new THREE.BatchedMesh(count, maxVerts, maxIndices, material);
      const batched = new THREE.BatchedMesh(count, maxVerts, maxIndices, material.clone());
      // three.js WebGPU bug: culling+shadows drops opaque batches; revisit on upgrade
      batched.castShadow = true;
      batched.perObjectFrustumCulled = false;
      batched.receiveShadow = false;

      const lodGeometryIds = lodGeos.map(g => (g ? batched.addGeometry(g) : -1));
      const firstLevel = lodGeometryIds.findIndex(id => id !== -1);

      const instanceIds: number[] = [];
      for (let i = 0; i < count; i++) {
        const id = batched.addInstance(lodGeometryIds[firstLevel]);
        batched.setMatrixAt(id, matrices[i]);
        // Hide instances whose material has no geometry at the starting level (billboard batch)
        if (firstLevel !== 0) batched.setVisibleAt(id, false);
        instanceIds.push(id);
      }

      this.treeGroup.add(batched);
      batches.push({ mesh: batched, lodGeometryIds, instanceIds });
    }

    const positions = new Float32Array(count * 2);
    const pos = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      pos.setFromMatrixPosition(matrices[i]);
      positions[i * 2] = pos.x;
      positions[i * 2 + 1] = pos.z;
    }

    const sphere = new THREE.Sphere();
    let cullRadius = 10;
    if (batches.length && batches[0].instanceIds.length) {
      batches[0].mesh.getBoundingSphereAt(batches[0].instanceIds[0], sphere);
      cullRadius = sphere.radius * 1.5; // pad for scale variation across instances
    }
    
    this.lodEntries.push({
      batches,
      allMatrices: matrices,
      positions,
      cullRadius,
      maxDistance: treeConfig.maxDistance ?? Infinity,
      lodDistances,
      currentLevel: new Uint8Array(count),
    });

    return batches.map(b => b.mesh);
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

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const HIDDEN = 255;
    const SHADOW_KEEP_SQ = 100 * 100; // near trees never cull: their shadows can reach into view

    const projScreen = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(projScreen);
    const sphere = new THREE.Sphere();

    for (const entry of this.lodEntries) {
      // const { batches, positions, lodDistances, maxDistance, currentLevel } = entry;
      const { batches, positions, lodDistances, maxDistance, currentLevel, cullRadius, allMatrices } = entry;

      const count = currentLevel.length;
      const distsSq = lodDistances.map(d => d * d);
      const maxDistSq = maxDistance * maxDistance;
      const numLevels = batches.length
        ? Math.max(...batches.map(b => b.lodGeometryIds.length))
        : 0;

      for (let i = 0; i < count; i++) {
        const dx = positions[i * 2] - camX;
        const dz = positions[i * 2 + 1] - camZ;
        const dSq = dx * dx + dz * dz;

        let level = HIDDEN;
        if (dSq < maxDistSq) {
          level = 0;
          for (let l = 0; l < distsSq.length; l++) {
            if (dSq >= distsSq[l]) level = l + 1;
          }
          level = Math.min(level, numLevels - 1);
        }
        // Frustum cull: out of view AND far enough that its shadow can't reach into view
        if (level !== HIDDEN && dSq > SHADOW_KEEP_SQ) {
          sphere.center.setFromMatrixPosition(allMatrices[i]);
          sphere.radius = cullRadius;
          if (!frustum.intersectsSphere(sphere)) level = HIDDEN;
        }

        if (level === currentLevel[i]) continue;
        currentLevel[i] = level;

        for (const batch of batches) {
          const id = batch.instanceIds[i];
          const geoId = level === HIDDEN ? -1 : (batch.lodGeometryIds[level] ?? -1);
          if (geoId === -1) {
            batch.mesh.setVisibleAt(id, false);
          } else {
            batch.mesh.setGeometryIdAt(id, geoId);
            batch.mesh.setVisibleAt(id, true);
          }
        }
      }
    }


  }
  update(camera: THREE.Camera, isShotActive: boolean) {
    
    this.#frameNum++;

    if (this.#frameNum % 5 === 0) {
      const dx = camera.position.x - this.#lastCamX;
      const dz = camera.position.z - this.#lastCamZ;
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const turned = dir.dot(this.#lastCamDir) < 0.999; // ~2.5° rotation
      if (dx * dx + dz * dz < 1.0 && !turned) return; // neither moved nor turned — skip
      this.#lastCamDir.copy(dir);

      this.#lastCamX = camera.position.x;
      this.#lastCamZ = camera.position.z;

      this.#updateLODs(camera);
    }
  }

  
}
