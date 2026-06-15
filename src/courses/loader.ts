import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { type World } from '@dimforge/rapier3d-compat';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import EventEmitter from 'eventemitter3';

import { getAverageTextureColor, getTextureImageData } from '@/utils/image';
import { TreeGroup, TreePlanter } from '@/trees';
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
import golfCupModel from '@/models/golfCup.glb?url';
import { QualityMode } from '@/utils/quality';



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

type MeshLoaderOptions = {
  ktx2Path?: string;
}
export class MeshLoader extends EventEmitter<CourseLoaderEvents> {
  gltfLoader: GLTFLoader;
  
  constructor(renderer: THREE.WebGLRenderer | WebGPURenderer, manager?: THREE.LoadingManager, options: MeshLoaderOptions = {}) {
    super();
    const ktx2Path = options.ktx2Path ?? '/ktx2/';
    const ktx2Loader = new KTX2Loader().setTranscoderPath(ktx2Path).detectSupport(renderer);
    this.gltfLoader = new GLTFLoader(manager);
    this.gltfLoader.setKTX2Loader(ktx2Loader);
  }
  
  async load(meshUri: string, firstMeshOnly?: false): Promise<THREE.Group>;
  async load(meshUri: string, firstMeshOnly: true): Promise<THREE.Mesh | undefined>;
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

type CourseLoaderOptions = {
  manager?: THREE.LoadingManager,
  setupData: Partial<OpenGolfSim.SetupData>,
  qualityLevel: QualityMode,
  meshLoaderOptions?: MeshLoaderOptions
}

export class CourseLoader extends EventEmitter<CourseLoaderEvents> {
  world: World;
  rapier: RapierInstance;
  meshLoader: MeshLoader;
  holes: Map<string, any>;
  waterSurfaces: Map<string, any>;
  surfaces: Map<string, LoadedCourseSurface>;
  grasses: Map<string, any>;
  greenGrids: Map<string, any>;
  courseMap?: ImageBitmap;
  courseSize: number;
  qualityLevel: QualityMode;
  
  gltf?: GLTF;
  scene?: THREE.Group;
  setupData?: Partial<OpenGolfSim.SetupData>;
  golfCup?: THREE.Mesh;
  sceneSettings?: SceneSettings;
  grassAssets?: GrassAssets;
  planter?: TreePlanter;

  #raycaster: THREE.Raycaster;
  #origin: THREE.Vector3;
  #direction: THREE.Vector3;
  #accumulator = 10;

  constructor(
    world: World,
    rapier: RapierInstance,
    renderer: THREE.WebGLRenderer | WebGPURenderer,
    options: CourseLoaderOptions
  ) {
    super();
    this.world = world;
    this.rapier = rapier;
    this.qualityLevel = options.qualityLevel;
    this.meshLoader = new MeshLoader(renderer, options.manager, options.meshLoaderOptions);
    this.setupData = options.setupData || {};
    this.courseSize = 1000;

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
    this.gltf = await this.meshLoader.gltfLoader.loadAsync(coursePath);
    this.scene = this.gltf.scene;
    if (this.gltf.userData?.courseSize) {
      this.courseSize = this.gltf.userData.courseSize;
    } else {
      console.warn('Course missing world size! Defaulting to 1000');
    }
    this.sceneSettings = this.gltf.userData?.sceneSettings ?? {};

    console.log(' ---- Loaded FUSE course ----');
    console.dir(this.gltf.userData);
    console.log(' ----               ----');
    
    this.golfCup = await this.meshLoader.load(golfCupModel, true);

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
    await this._parseMap();


    return this.scene;
  }

  update(dt: number, camera: ShotPerspectiveCamera, isShotActive: boolean = false) {
    // update water and other animations that happen each frame
    this.waterSurfaces.forEach(water => water.update(dt));
    

    // planting / LOD logic only needs to happen every few frames
    if (this.#accumulator >= 4) {
      this.greenGrids.forEach(grid => grid.update(camera));
      this.grasses.forEach(grass => grass.update(dt, camera));
      this.planter?.update(camera, isShotActive);
      this.#accumulator = 0;
    }
    this.#accumulator++;
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

      const { surfaceType, surfaceSettings } = this._detectSurface(child);
      if (surfaceType) {
        const surfaceOptions = { type: surfaceType, ...surfaceSettings };
        // console.log('set', surfaceOptions);
        const ground = new GroundPhysics(child, this.world, this.rapier, surfaceOptions);
        // console.log(child.name, surfaceType);
        // this.surfaceByCollider.set(ground.collider.handle, { type: surfaceType, ...surfaceSettings, mesh: child });
        if (surfaceType === 'sand') {
          child.material = new SandShaderMaterial(child.material);

        } else if (['fringe', 'fairway', 'first_cut'].includes(surfaceType)) {
          child.material = new FlatGrassShaderMaterial(child.material, {
            blendNoiseScale: 0.1,
          });

        } else if (this.qualityLevel > QualityMode.Low && surfaceType === 'rough') {
          const grassOptions = {
            density: 18,
            renderDistance: 25,
            cellSize: 5,
            lean: 0.01,
            heightVariation: 0.05,
            maxNewCellsPerFrame: 10,
            scaleXZ: 0.8,
            scaleY: 0.75,
            layer: 2,
            baseColor: new THREE.Color('#3a4a13'),
            tipColor1: new THREE.Color('#5c7c2e'),
            tipColor2: new THREE.Color('#ffffff'),
          };
          
          if (this.qualityLevel > QualityMode.Medium) {
            grassOptions.renderDistance = 50;
          }
          
          const grass = new GrassShader(child, this.grassAssets!, grassOptions);
          this.scene.add(grass.mesh);
          this.grasses.set(child.uuid, grass);

        } else if (this.qualityLevel !== QualityMode.Low && ['deep_rough', 'base'].includes(surfaceType)) {
          
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
            tipColor1: '#65792d',
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

  async _parseMap() {
    if (!this.gltf) {
      throw new Error('Course file not loaded');
    }
    const parser = this.gltf.parser;
    const courseMap = (parser.json?.images || []).find(
      (img: any) => img.extras?.type === 'course_map'
    );
    const buffer = await parser.getDependency('bufferView', courseMap.bufferView);
    const blob = new Blob([buffer], { type: 'image/jpeg' });
    const bitmap = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
    this.courseMap = bitmap;
  }

  async _addTrees() {
    if (!this.scene) {
      throw new Error('Course scene not loaded');
    }
    if (!this.gltf) {
      throw new Error('Course file not loaded');
    }
    

    const parser = this.gltf.parser;
    const treeMasks = (parser.json?.images || []).filter(
      (img: any) => img.extras?.type === 'tree_mask'
    ) as TreeImage[];

    this.planter = new TreePlanter({
      scene: this.scene,
      worldSize: this.courseSize,
      qualityLevel: this.qualityLevel,
      world: this.world,
      rapier: this.rapier
    });

    const treeConfigs: Record<string, TreeGroup[]> = {};
    this.scene.traverse((child) => {
      if (child.userData?.type === 'tree_template') {
        const layerId = child.userData?.treeLayerId;

        const group = TreePlanter.loadTree(child);

        let lodDistances = [50, 100];
        if (this.qualityLevel === QualityMode.Medium) {
          lodDistances = [100, 200];
        } else if (this.qualityLevel === QualityMode.High) {
          lodDistances = [200, 400];
        }
        console.log(`Planting trees with LODs: ${lodDistances.join(',')}`)

        const config: TreeGroup = {
          collider: {
            radius: 0.3,
            height: 2.0,
          }, // base collider, can be customized
          scaleRange: { min: 1, max: 1 },
          density: 1,
          minDistance: 3,
          lodDistances,
          colors: [],
          meshGroup: group,
          ...child.userData
        };

        if (!treeConfigs?.[layerId]) {
          treeConfigs[layerId] = [config];
        } else {
          treeConfigs[layerId].push(config);
        }
      }
    });


    for (const treeMask of treeMasks) {
      if (!treeMask.extras?.id) {
        continue;
      }
      const configs = treeConfigs?.[treeMask.extras.id];

      if (configs?.length && treeMask.bufferView) {
        const buffer = await this.gltf.parser.getDependency('bufferView', treeMask.bufferView);
        const maskData = await getTextureImageData(buffer);
        this.planter.plantFromMask(configs, maskData);
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

    const flag = new FlagStick(position, holeNumber, this.golfCup);
    const target = new TargetShaderMaterial(hit.object, position);
    this.scene.add(flag.object);

    return { object: hit.object, flag, target };
  }
}