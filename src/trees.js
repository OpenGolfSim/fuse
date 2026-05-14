import * as THREE from 'three';

function seededRandom(seed) {
  return function() {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };
}

export class TreePlanter {
  /**
   * @param {THREE.Scene} scene
   * @param {number} worldSize
   * @param {object} [options]
   * @param {THREE.Mesh|THREE.Mesh[]} options.groundMeshes - mesh(es) to raycast against for Y placement
   * @param {object} [options.world] - RAPIER physics world (optional, enables colliders)
   * @param {object} [options.RAPIER] - RAPIER module (optional, enables colliders)
   */
  constructor(scene, worldSize, { groundMeshes, world, RAPIER } = {}) {
    this.scene = scene;
    this.worldSize = worldSize;
    this.world = world ?? null;
    this.RAPIER = RAPIER ?? null;
    this.physicsEnabled = !!(this.world && this.RAPIER);

    // Normalise groundMeshes to an array
    this.groundMeshes = groundMeshes
      ? (Array.isArray(groundMeshes) ? groundMeshes : [groundMeshes])
      : [];

    // Three.js raycaster used when RAPIER isn't available (or always for Y)
    this._raycaster = new THREE.Raycaster();
    this._raycaster.firstHitOnly = true; // requires three-mesh-bvh or r152+

    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
  }

  get hasPhysics() {
    return this.physicsEnabled;
  }

  clear() {
    this.scene.remove(this.treeGroup);
    this.treeGroup = new THREE.Group();
    this.lods = [];
    this.scene.add(this.treeGroup);
  }

  /**
   * Raycast downward to find the ground Y at (x, z).
   * Uses RAPIER if available, otherwise falls back to THREE.Raycaster.
   * @returns {number|null} ground Y, or null if no hit
   */
  _getGroundY(x, z) {
    const originY = 200;

    if (this.physicsEnabled) {
      const ray = new this.RAPIER.Ray(
        { x, y: originY, z },
        { x: 0, y: -1, z: 0 }
      );
      const hit = this.world.castRay(ray, 500, true);
      if (hit == null) {
        console.log('No ground hit...');
        return null;
      }
      return originY - hit.timeOfImpact;
    }

    // Three.js fallback
    if (this.groundMeshes.length === 0) return 0; // no ground info, plant at y=0

    this._raycaster.set(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0)
    );
    const hits = this._raycaster.intersectObjects(this.groundMeshes, true);
    if (hits.length === 0) return null;
    return hits[0].point.y;
  }

  /**
   * Optionally create a physics collider for a planted tree.
   * No-ops when physics aren't available.
   */
  _addCollider(pos, scale, baseHeight, baseRadius, userData) {
    if (!this.physicsEnabled) return;

    const RAPIER = this.RAPIER;
    const s = scale;
    const bodyDesc = RAPIER.RigidBodyDesc.fixed()
      .setTranslation(pos.x, pos.y + (baseHeight * s) / 2, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cylinder(
      (baseHeight * s) / 2,
      baseRadius * s
    );
    const collider = this.world.createCollider(colliderDesc, body);
    collider.userData = userData;
  }

  extractLODs(gltfScene) {
    this.lods = [];
    gltfScene.traverse((child) => {
      if (!child.isMesh) return;
      const name = (child.name || child.parent?.name || '').toUpperCase();
      const match = name.match(/LOD(\d+)/);
      if (match) {
        const level = parseInt(match[1]);
        if (!this.lods[level]) this.lods[level] = { meshes: [], level };
        this.lods[level].meshes.push(child);
      } else if (name.includes('BILLBOARD')) {
        this.lods.push({ meshes: [child], level: 999, isBillboard: true });
      }
    });
    return this.lods.filter(Boolean).sort((a, b) => a.level - b.level);
  }

  /**
   * Simple rectangular planting (unchanged API).
   */
  plant(mesh, count, area, scaleRange) {
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, count);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const x = ((Math.random() - 0.5) * area.width) + area.xOffset;
      const z = area.zMin + Math.random() * (area.zMax - area.zMin);
      const y = this._getGroundY(x, z) ?? -0.1;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      const s = scaleRange.min + Math.random() * (scaleRange.max - scaleRange.min);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    this.treeGroup.add(instanced);
    return instanced;
  }

  /**
   * @param {Array<{meshGroup: THREE.Group, scaleRange: {min:number,max:number}, density: number, colors: number[], collider?: boolean}>} trees
   * @param {object} maskData - { data, width, height } from getImageData
   * @param {number} [seed=12345]
   */
  plantFromMask(trees, maskData, seed = 12345) {
    const { data, width, height } = maskData;
    const cellW = this.worldSize / width;
    const cellH = this.worldSize / height;
    const random = seededRandom(seed);

    const totalDensity = trees.reduce((sum, t) => sum + t.density, 0);
  console.log('tree configs:', trees.map(t => ({
    density: t.density,
    scaleRange: t.scaleRange,
    childCount: t.meshGroup?.children?.length,
  })));
  console.log('totalDensity:', totalDensity);

    const cumulativeWeights = [];
    let cumSum = 0;
    for (const t of trees) {
      cumSum += t.density / totalDensity;
      cumulativeWeights.push(cumSum);
    }
    cumulativeWeights[cumulativeWeights.length - 1] = 1.0;

    // Phase 1: scatter XZ from mask
    const scattered = trees.map(() => []);

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
          scattered[treeIdx].push({
            x: (px + random()) * cellW,
            z: (py + random()) * cellH,
          });
        }
      }
    }
    console.log('scattered counts:', scattered.map(s => s.length));

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
      console.log('scaleRange:', scaleRange);

      const matrices = [];
      for (const { x, z } of points) {
        const y = this._getGroundY(x, z);
        if (y == null) continue;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, random() * Math.PI * 2, 0);
        const s = scaleRange.min + random() * (scaleRange.max - scaleRange.min);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        matrices.push(dummy.matrix.clone());
      }

  
      console.log('matrix counts:', matrices.length);
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

      // Phase 3: instanced meshes
      const count = matrices.length;
      const color = new THREE.Color();
      const pickedColors = colors?.length > 0
        ? Array.from({ length: count }, () => colors[Math.floor(random() * colors.length)])
        : [];

      const instancedMeshes = [];
      // const meshChildren = [];
      // meshGroup.traverse((child) => {
      //   if (child.isMesh) meshChildren.push(child);
      // });
      // meshChildren.forEach((child) => {

      meshGroup.children.forEach((child) => {
        if (!child.isMesh) return;

        const geo = child.geometry.clone();
        child.updateWorldMatrix(true, false);
        const localMatrix = new THREE.Matrix4();
        localMatrix.copy(meshGroup.matrixWorld).invert().multiply(child.matrixWorld);
        geo.applyMatrix4(localMatrix);

        const instanced = new THREE.InstancedMesh(geo, child.material.clone(), count);
        const isLeaf = child.name.toLowerCase().includes('leaf');

        for (let i = 0; i < count; i++) {
          instanced.setMatrixAt(i, matrices[i]);
          if (isLeaf && pickedColors.length > 0) {
            color.set(pickedColors[i]);
            instanced.setColorAt(i, color);
          }
        }

        if (isLeaf && instanced.instanceColor) instanced.instanceColor.needsUpdate = true;
        instanced.instanceMatrix.needsUpdate = true;
        instanced.frustumCulled = false;
        instanced.castShadow = true;
        instanced.receiveShadow = true;

        this.treeGroup.add(instanced);
        instancedMeshes.push(instanced);
      });
      console.log('meshes found for instancing:', instancedMeshes.length);

      allResults.push(instancedMeshes);
    }

    return allResults;
  }
}
