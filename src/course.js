import { getTextureImageData } from "./imageUtils";
import { TreePlanter } from "./trees";

const SURFACES = new Map(Object.entries({
  green:     { hasCollider: true, friction: 0.3, restitution: 0.1, rollResistance: 0.1 },
  tee:     { hasCollider: true, friction: 0.3, restitution: 0.1, rollResistance: 0.1 },
  fringe:     { hasCollider: true, friction: 0.5, restitution: 0.1, rollResistance: 0.15 },
  fairway:   { hasCollider: true, friction: 0.4, restitution: 0.4, rollResistance: 0.15 },
  first_cut:   { hasCollider: true, friction: 0.4, restitution: 0.3, rollResistance: 0.14 },
  rough:     { hasCollider: true, friction: 0.5, restitution: 0.2, rollResistance: 0.40 },
  base:      { hasCollider: true, friction: 0.8, restitution: 0.15, rollResistance: 0.20 },
  sand:      { hasCollider: true, friction: 1.5, restitution: 0.02, rollResistance: 0.60 },
  water:     { hasCollider: true, friction: 1.0, restitution: 0.00, rollResistance: 1.00 },
  river:     { hasCollider: true, friction: 1.0, restitution: 0.00, rollResistance: 1.00 },
  cart_path: { hasCollider: true, friction: 0.3, restitution: 0.50, rollResistance: 0.01 },
  lake_surface: { hasCollider: false, friction: 0.3, restitution: 0.50, rollResistance: 0.01 },
  plane_river: { hasCollider: false, friction: 0.3, restitution: 0.50, rollResistance: 0.01 },
  default:   { hasCollider: true, friction: 0.5, restitution: 0.02, rollResistance: 0.05 },
}));

export class CourseLoader {
  constructor(world, RAPIER, options = {}) {
    this.world = world;
    this.RAPIER = RAPIER;
    this.gltfLoader = new GLTFLoader();
    this.holes = new Map();
    this.waterSurfaces = new Map();
    // this.surfaceByCollider = new Map();
    this.surfaces = new Map();
    
    this.groundLayerMask = options.groundLayerMask;
  }

  async load(coursePath) {
    this.gltf = await gltfLoader.loadAsync(coursePath);
    this.scene = this.gltf.scene;
    this._parseCourseHoles();
    this._addCourseColliders();
    this._addWater();
    await this._addTrees();
    return this.scene;
  }

  update(dt) {
    // update water and other animations
    this.waterSurfaces?.values().forEach(water => water.update());    
  }

  _addCourseColliders() {
    this.scene.updateMatrixWorld(true); // critical — bakes the position.set applied when loaded
    this.surfaces.clear();
    
    const tmp = new THREE.Vector3();
    this.scene.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes.position) return;
      child.receiveShadow = true;
      // Disable vertex color rendering on all meshes —
      // we only use them as data, not visual color
      if (child.material) {
        child.material.vertexColors = false;
        child.material.needsUpdate = true;
      }
      if (this.groundLayerMask) {
        console.log(`Enabling layer ${this.groundLayerMask} on ${child.name}`);
        child.layers.enable(this.groundLayerMask);
        console.log('ground layers:', child.layers.mask.toString(2));
      }

      // child.material.color = 0xFF0000;
      // child.material.wireframe = true;
      // this.groundPhysics.push(ground);
      const { surfaceType, surfaceSettings } = this._detectSurface(child);
      const surfaceOptions = { type: surfaceType, ...surfaceSettings };
      // console.log('set', surfaceOptions);
      const ground = new GroundPhysics(child, this.world, this.RAPIER, surfaceOptions);
      // console.log(child.name, surfaceType);
      // this.surfaceByCollider.set(ground.collider.handle, { type: surfaceType, ...surfaceSettings, mesh: child });
      if (surfaceType === 'sand') {
        // ShaderUtils.extractTintAttribute(child.geometry);
        const mat = new SandShaderMaterial(child.material);
        child.material = mat;
        // child.material.vertexColors = true;
      }
      this.surfaces.set(child.uuid, { ...surfaceOptions, mesh: child, ground });
    });
    this.world.step();
  }


  _loadTree(tree) {
    const treeGroup = new THREE.Group();
    tree.scale.set(1, 1, 1);
    tree.updateMatrixWorld(true);
    tree.traverse((child) => {
      if (child.isMesh) {
        const mesh = child.clone();
        child.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        treeGroup.add(mesh);
      }
    });
    return treeGroup;
  }
  async _addTrees() {
    const parser = this.gltf.parser;
    const json = parser.json;
    this.planter = new TreePlanter(this.scene, 1000, { world: this.world, RAPIER: this.RAPIER });
    const treeConfigs = {};
    this.scene.traverse((child) => {
      if (child.name.startsWith('TREE_')) {
        const layerId = child.userData?.treeLayerId;
        // console.log('child', child);
        // child.traverse((c) => {
        //   console.log(c.name, c.type, c.isMesh);
        // });
        const group = this._loadTree(child);
        // Reset scale so child meshes have correct transforms

        const config = { meshGroup: group, ...child.userData };
        if (!treeConfigs?.[layerId]) {
          treeConfigs[layerId] = [config];
        } else {
          treeConfigs[layerId].push(config);
        }
      }
    });
    console.log('treeConfigs', treeConfigs);

    const treeImages = parser.json.images.filter(
      img => img.extras?.type === 'tree_mask' || img.extras?.id?.startsWith('tree-')
    );
    for (const treeImage of treeImages) {
      console.log('treeImage', treeImage.extras);
      if (!treeImage.extras?.id) {
        continue;
      }
      const treeMeshes = treeConfigs?.[treeImage.extras.id];
      if (treeMeshes?.length) {
        const maskData = await getTextureImageData(this.gltf, treeImage);
        console.log('treeMeshes', treeMeshes);
        console.log('maskData', maskData);
        this.planter.plantFromMask(
          treeMeshes,
          maskData
        );
      }
      
    }

  }
  _addWater() {
    this.waterSurfaces.clear();
    const toReplace = [];
    this.scene.traverse((child) => {
      if (['plane_river', 'lake_surface'].includes(child.userData?.surface)) {
        toReplace.push(child);
      }
    });

    toReplace.forEach(child => {
      let surface;
      let offsetY;
      if (child.userData?.surface === 'plane_river') {
        offsetY = -0.2;
        surface = new WaterSurface(child, 0.5, {
          alpha: 0.5,
          sunColor: 0x4c85a8,
          waterColor: 0x103f5c,
          distortionScale: 0.5,
        });
        
      } else if (child.userData?.surface === 'lake_surface') {
        offsetY = -0.2;
        surface = new WaterSurface(child, 0.25, {
          alpha: 0.9,
          sunColor: 0x4c85a8,
          waterColor: 0x103f5c,
          distortionScale: 0.1,
        });
      }

      if (surface) {
        // Copy the original mesh's world transform onto the water
        child.updateWorldMatrix(true, false);
        surface.water.applyMatrix4(child.matrixWorld);
        surface.water.position.y += offsetY;

        this.waterSurfaces.set(child.uuid, surface);
        this.scene.add(surface.water);
        this.scene.remove(child);
      }
    });
  }

  _detectSurface(mesh) {
    // Prefer explicit userData (set this in Blender's Custom Properties on the object)
    let surfaceType = 'default';

    if (mesh.userData?.surface) {
      surfaceType = mesh.userData.surface;
      // return { surfaceType: mesh.userData.surface, surfaceSettings };
    }
    // Fall back to name-based matching?
    const name = mesh.name.toLowerCase();
    for (const key of Object.keys(SURFACES)) {
      if (key !== 'default' && name.startsWith(key)) {
        surfaceType = key;
      }
    }

    const surfaceSettings = SURFACES.get(surfaceType);
    if (!surfaceSettings) {
      throw new Error(`No settings defined for '${mesh.userData.surface}'`);
    }    
    return { surfaceType, surfaceSettings };
  }

  _parseCourseHoles() {
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    this.holes.clear();

    const groundMeshes = [];
    this.scene.traverse((node) => {
      if (node.isMesh) {
        groundMeshes.push(node);
      }
    });

    this.scene.traverse((node) => {
      const { type, hole: holeNumber, order, mapX, mapY } = node.userData;
      if (type === 'hole_group') {
        const { holeNum, par } = node.userData;
        if (!this.holes.has(holeNum)) {
          this.holes.set(holeNum, { number: holeNum, par, waypoints: new Map() });
        }
      } else if (['tee','aim','hole'].includes(type)) {
        const { holeNum, order, mapX, mapY } = node.userData;
        raycaster.set(new THREE.Vector3(mapX, 5000, mapY), down);
        const hits = raycaster.intersectObjects(groundMeshes);
        let position = new THREE.Vector3(mapX, 10, mapY);
        if (hits.length > 0) {
          position.y = hits[0].point.y;
        }
        if (this.holes.has(holeNum)) {
          this.holes.get(holeNum).waypoints.set(type, position);
        }
      }
    });
  }
}