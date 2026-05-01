export class TreePlanter {
  constructor(scene) {
    this.scene = scene;
    this.treeGroup = new THREE.Group();
    this.scene.add(this.treeGroup);
  }
  
  clear() {
    this.scene.remove(this.treeGroup);
    this.treeGroup = new THREE.Group();
    this.lods = []; // [{ meshes: [...], maxDistance: N }, ...]
    this.scene.add(this.treeGroup);
  }

  extractLODs(gltfScene) {
    this.lods = [];
    gltfScene.traverse((child) => {
      if (!child.isMesh) return;
      // SpeedTree naming conventions vary, but typically:
      // "TreeName_LOD0", "TreeName_LOD1", or parent groups named "LOD0", etc.
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
   * 
   * @param {object} mesh 
   * @param {number} count 
   * @param {object} area 
   * @param {number} area.width
   * @param {number} area.xOffset
   * @param {number} area.zMin
   * @param {number} area.zMax
   * @param {object} scaleRange 
   * @param {number} scaleRange.min
   * @param {number} scaleRange.max
   * @returns 
   */
  plant(mesh, count, area, scaleRange) {
    const instanced = new THREE.InstancedMesh(
      mesh.geometry,
      mesh.material,
      count
    );

    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      // Random position within a rectangular area
      dummy.position.set(
        ((Math.random() - 0.5) * area.width) + area.xOffset,
        -0.1,
        area.zMin + Math.random() * (area.zMax - area.zMin)
      );

      // Random Y rotation so they don't all face the same way
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);

      // Random scale variation
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
}