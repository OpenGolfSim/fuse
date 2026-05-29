import * as THREE from 'three';
import { type World } from '@dimforge/rapier3d-compat';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import EventEmitter from 'eventemitter3';

import { getTextureImageData } from '@/utils/image';
import { TreePlanter } from '@/trees';
import { TargetShaderMaterial } from '@/shaders/target';
import { SandShaderMaterial } from '@/shaders/sand';
import { GrassAssets, GrassShader } from '@/shaders/grass';
import { WaterSurface } from '@/shaders/water';
import { FlatGrassShaderMaterial } from '@/shaders/grassFlat';
import { FlagStick } from '@/objects/flagStick';
import { type ShotPerspectiveCamera } from '@/camera';
import { GroundPhysics } from '@/physics/groundPhysics';
import { CourseSurfaceProperties, CourseSurfaces, isCourseSurfaceType } from '@/courses/surfaces';
import perlinNoise from '@/images/perlinnoise.webp?url';
import { isMeshObject } from '@/utils/mesh';
import grassBladesModel from '@/models/grassBlades.glb?url';

export interface SceneSettings {
  sky?: {
    type?: string;
    clouds?: {
      skyColor?: string;
      fogColor?: string;
      cloudColor?: string;
      density?: number;
      opacity?: number;
      scale?: number;
      position?: number[];
    };
  }
}

interface CourseLoaderProgressEvent {
  percent: number,
  itemsLoaded: number,
  itemsTotal: number
}

interface CourseLoaderEvents {
  progress: (progress: CourseLoaderProgressEvent) => void
}

export class MeshLoader extends EventEmitter<CourseLoaderEvents> {
  gltfLoader: GLTFLoader;
  
  constructor(manager?: THREE.LoadingManager) {
    super();
    this.gltfLoader = new GLTFLoader(manager);
  }
  
  async load(meshUri: string, firstMeshOnly = false): Promise<THREE.Mesh | THREE.Group | undefined> {
    const model = await this.gltfLoader.loadAsync(meshUri);
    if (!firstMeshOnly) {
      return model.scene;
    }
    let mesh: THREE.Mesh | undefined;
    model.scene.traverse((child) => {
      if (isMeshObject(child) && !mesh) mesh = child;
    });
    if (!mesh) {
      return;
    }
    return mesh;
  }  
}

interface LoadedCourseSurface extends CourseSurfaceProperties {
  mesh: THREE.Mesh,
  ground: GroundPhysics,
}

export class CourseLoader extends EventEmitter<CourseLoaderEvents> {
  world: World;
  rapier: RapierInstance;
  gltfLoader: GLTFLoader;
  holes: Map<string, any>;
  waterSurfaces: Map<string, any>;
  surfaces: Map<string, LoadedCourseSurface>;
  grasses: Map<string, any>;
  greenGrids: Map<string, any>;

  
  gltf?: GLTF;
  scene?: THREE.Group;
  sceneSettings?: SceneSettings;
  grassAssets?: GrassAssets;
  planter?: TreePlanter;

  #raycaster: THREE.Raycaster;
  #origin: THREE.Vector3;
  #direction: THREE.Vector3;
  setupData?: Partial<OpenGolfSim.SetupData>;

  constructor(world: World, rapier: RapierInstance, setupData: OpenGolfSim.SetupData | undefined, manager?: THREE.LoadingManager) {
    super();
    this.world = world;
    this.rapier = rapier;
    this.gltfLoader = new GLTFLoader(manager);
    this.setupData = setupData || {};

    this.holes = new Map();
    this.waterSurfaces = new Map();
    // this.surfaceByCollider = new Map();
    this.surfaces = new Map();
    this.grasses = new Map();
    this.greenGrids = new Map();
    
    this.#raycaster = new THREE.Raycaster();
    this.#origin = new THREE.Vector3();
    this.#direction = new THREE.Vector3(0, -1, 0);

  }

  async load(coursePath: string) {
    this.gltf = await this.gltfLoader.loadAsync(coursePath);
    this.scene = this.gltf.scene;
    this.sceneSettings = this.gltf.userData?.sceneSettings || {};

    // load the model + textures once during init
    this.grassAssets = await GrassShader.loadAssets({
      modelPath: grassBladesModel,
      noisePath: perlinNoise
    });
    if (!this.grassAssets) {
      throw new Error('Unable to load grass assets');
    }

    this._parseCourseHoles();
    this._addCourseColliders();
    this._addWater();
    await this._addTrees();

    // if (this.options.debug) {
    //   this.debugLines = new THREE.LineSegments(
    //     new THREE.BufferGeometry(),
    //     new THREE.LineBasicMaterial({ color: 0x00ff00, vertexColors: true })
    //   );
    //   this.debugLines.frustumCulled = false;
    //   this.scene.add(this.debugLines);
    //   if (this.debugLines) {
    //     const buffers = this.world.debugRender();
    //     this.debugLines.geometry.setAttribute('position', new THREE.BufferAttribute(buffers.vertices, 3));
    //     this.debugLines.geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 4));
    //   }
    // }


    return this.scene;
  }

  update(dt: number, camera: ShotPerspectiveCamera) {
    // update water and other animations
    this.waterSurfaces.forEach(water => water.update(dt));
    this.grasses.forEach(grass => grass.update(dt, camera));
    this.greenGrids.forEach(grid => grid.update(camera));
  }

  _addCourseColliders() {
    if (!this.scene) {
      console.warn('No scene defined!');
      return;
    }
    this.scene.updateMatrixWorld(true); // critical — bakes the position.set applied when loaded
    this.surfaces.clear();
    this.grasses.clear();
    this.greenGrids.clear();
        

    this.scene.traverse((child) => {
      if (!this.scene) { return; }
      if (!(child instanceof THREE.Mesh)) { return; }
      if (!child.isMesh || !child.geometry?.attributes.position) return;
      child.receiveShadow = true;
      
      // Disable vertex color rendering on all meshes —
      // we only use them as data, not visual color
      if (child.material) {
        child.material.vertexColors = false;
        child.material.needsUpdate = true;
      }

      // if (this.groundLayerMask) {
      //   console.log(`Enabling layer ${this.groundLayerMask} on ${child.name}`);
      //   child.layers.enable(this.groundLayerMask);
      //   console.log('ground layers:', child.layers.mask.toString(2));
      // }

      const { surfaceType, surfaceSettings } = this._detectSurface(child);
      if (surfaceType) {
        const surfaceOptions = { type: surfaceType, ...surfaceSettings };
        // console.log('set', surfaceOptions);
        const ground = new GroundPhysics(child, this.world, this.rapier, surfaceOptions);
        // console.log(child.name, surfaceType);
        // this.surfaceByCollider.set(ground.collider.handle, { type: surfaceType, ...surfaceSettings, mesh: child });
        if (surfaceType === 'sand') {
          child.material = new SandShaderMaterial(child.material);
          // const mat = new SandShaderMaterial(child.material);
          // child.material = mat;
          // child.material.vertexColors = true;
        } else if (['fringe', 'fairway', 'first_cut'].includes(surfaceType)) {
          child.material = new FlatGrassShaderMaterial(child.material, {
            blendNoiseScale: 0.1,
          });
        } else if (surfaceType === 'rough') {
          // const grass = new GrassSystem(child, this.grassTex);
          // this.scene.add(grass);
          const grass = new GrassShader(child, this.grassAssets!, {
            density: 18,
            renderDistance: 25,
            cellSize: 5,
            lean: 0.01,
            heightVariation: 0.05,
            maxNewCellsPerFrame: 10,
            scaleXZ: 0.9,
            scaleY: 0.75,
            layer: 2,
            baseColor: '#364d1e',
            tipColor1: '#6f9b34',
            tipColor2: '#6d9633',
          });
          this.scene.add(grass.mesh);
          this.grasses.set(child.uuid, grass);

        } else if (['deep_rough', 'base'].includes(surfaceType)) {
          // const grass = new GrassSystem(child, this.grassTex);
          // this.scene.add(grass);
          const grass = new GrassShader(child, this.grassAssets!, {
            density: 10,
            renderDistance: 60,
            cellSize: 10,
            lean: 0.03,
            layer: 2,
            heightVariation: 0.05,
            maxNewCellsPerFrame: 10,
            scaleXZ: 1.2,
            scaleY: 2,
            baseColor: '#395220',   // match your terrain's green
            tipColor1: '#7da14d',
            tipColor2: '#59792d',
          });
          this.scene.add(grass.mesh);
          this.grasses.set(child.uuid, grass);
        }
        this.surfaces.set(child.uuid, { ...surfaceOptions, mesh: child, ground });
      }
    });
    this.world.step();
  }
  
  getGroundY(x: number, z: number, startY = 1000, maxDistance = 2000) {
    this.#origin.set(x, startY, z);
    this.#raycaster.set(this.#origin, this.#direction);
    this.#raycaster.far = maxDistance;

    const meshes = this.getGroundMeshes();
    const hits = this.#raycaster.intersectObjects(meshes, false);
    if (hits.length > 0) {
      const hit = hits[0];
      return { y: hit.point.y, object: hit.object };
    }
    return null;
  }

  getGroundMeshes() {
    return [...this.surfaces.values()].map(surface => surface.mesh).filter(Boolean);
  }

  _loadTree(tree: THREE.Object3D) {
    const treeGroup = new THREE.Group();
    tree.scale.set(1, 1, 1);
    tree.updateMatrixWorld(true);
    tree.traverse((child) => {
      if (child instanceof THREE.Mesh && child.isMesh) {
        const mesh = child.clone();
        child.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
        treeGroup.add(mesh);
      }
    });
    return treeGroup;
  }

  async _addTrees() {
    if (!this.scene) {
      throw new Error('Course scene not loaded');
    }
    if (!this.gltf) {
      throw new Error('Course file not loaded');
    }
    
    this.planter = new TreePlanter({
      scene: this.scene,
      worldSize: 1000,
      world: this.world,
      rapier: this.rapier,
      // groundMeshes: 
    });
    const treeConfigs: Record<string, any> = {};
    this.scene.traverse((child) => {
      if (child.name.startsWith('TREE_')) {
        const layerId = child.userData?.treeLayerId;
        const group = this._loadTree(child);
        const config = {
          collider: {
            radius: 0.3,
            height: 2.0
          }, // base collider, can be customized
          meshGroup: group,
          ...child.userData,
        };
        if (!treeConfigs?.[layerId]) {
          treeConfigs[layerId] = [config];
        } else {
          treeConfigs[layerId].push(config);
        }
      }
    });

    const parser = this.gltf.parser;
    const treeImages = parser.json.images.filter(
      (img: any) => img.extras?.type === 'tree_mask' || img.extras?.id?.startsWith('tree-')
    );

    for (const treeImage of treeImages) {
      if (!treeImage.extras?.id) {
        continue;
      }
      const treeMeshes = treeConfigs?.[treeImage.extras.id];
      if (treeMeshes?.length && treeImage.bufferView) {
        const buffer = await this.gltf.parser.getDependency('bufferView', treeImage.bufferView);
        const maskData = await getTextureImageData(buffer);
        this.planter.plantFromMask(treeMeshes, maskData);
      }
    }

  }
  _addWater() {
    if (!this.scene) throw new Error('Scene missing');
    this.waterSurfaces.clear();
    const toReplace: THREE.Object3D[] = [];
    this.scene.traverse((child) => {
      if (['plane_river', 'plane_lake'].includes(child.userData?.surface)) {
        toReplace.push(child);
      }
    });

    toReplace.forEach(child => {
      let surface;
      let offsetY = 0;
      if (!isMeshObject(child)) return;
      if (child.userData?.surface === 'plane_river') {
        offsetY = 0;
        surface = new WaterSurface(child, {
          speed: 0.25,
          water: {
            alpha: 0.5,
            sunColor: new THREE.Color('#4c85a8'),
            waterColor: new THREE.Color('#004671'),
            distortionScale: 0.5,
          }
        });
        
      } else if (child.userData?.surface === 'plane_lake') {
        offsetY = 0;
        surface = new WaterSurface(child, {
          speed: 0.25,
          textureScale: 4,
          water: {
            alpha: 0.8,
            waterColor: new THREE.Color('#0b4753')
          },
        });
      }

      if (surface) {
        // Copy the original mesh's world transform onto the water
        child.updateWorldMatrix(true, false);
        surface.water.applyMatrix4(child.matrixWorld);
        surface.water.position.y += offsetY;

        this.waterSurfaces.set(child.uuid, surface);
        this.scene?.add(surface.water);
        this.scene?.remove(child);
      }
    });
  }

  _detectSurface(mesh: THREE.Object3D) {
    // Prefer explicit userData (set this in Blender's Custom Properties on the object)
    if (!mesh.userData?.surface) {
      return {};
    }
    const surfaceType = mesh.userData.surface;
    const surfaceSettings = isCourseSurfaceType(surfaceType) && CourseSurfaces[surfaceType];
    if (!surfaceSettings) {
      throw new Error(`No settings defined for '${mesh.userData.surface}'`);
    }    
    return { surfaceType, surfaceSettings };
  }

  _parseCourseHoles() {
    if (!this.scene) throw new Error('Scene missing');
    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);

    this.holes.clear();

    const groundMeshes: THREE.Mesh[] = [];
    this.scene?.traverse((node) => {
      if (node instanceof THREE.Mesh && node.isMesh) {
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
      } else if (type === 'waypoint') {
        // ['tee','aim','pin'].includes(type)
        const { holeNum, order, mapX, mapY, waypoint: waypointType } = node.userData;
        raycaster.set(new THREE.Vector3(mapX, 5000, mapY), down);
        const hits = raycaster.intersectObjects(groundMeshes);
        let position = new THREE.Vector3(mapX, 10, mapY);
        if (hits.length > 0) {
          position.y = hits[0].point.y;
          if (waypointType === 'pin') {
            // add flagstick and target material
            if (this.holes.has(holeNum)) {
              const hole = this.holes.get(holeNum);
              hole.green = this._setupGreen(hits[0], position, hole.number);
            }
            // this._greens.set(holeNum, green);
          }
        }
        if (this.holes.has(holeNum)) {
          this.holes.get(holeNum).waypoints.set(waypointType, position);
        }
      }
    });
  }
  
  _setupGreen(hit: THREE.Intersection, position: THREE.Vector3, holeNumber: number) {
    if (!this.scene) throw new Error('Scene missing');
    const flag = new FlagStick(position, holeNumber);
    const target = new TargetShaderMaterial(hit.object, position);
    this.scene.add(flag.object);
    return { object: hit.object, flag, target };
  }
}