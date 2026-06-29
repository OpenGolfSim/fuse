import {
  WebGLRenderer,
  PCFShadowMap,
  ACESFilmicToneMapping,
  PMREMGenerator,
  Scene,
  type Camera,
  type Fog,
  type Mesh,
  type Texture,
} from 'three';
import { QualityMode } from './utils/quality';
import { WebGPURenderer } from 'three/webgpu';
import { WebGLNodesHandler } from 'three/examples/jsm/tsl/WebGLNodesHandler.js';

type FuseRendererOptions = {
  canvas: HTMLElement | null;
  antialias?: boolean;
  width?: number;
  height?: number;
  aspect?: number;
  container?: HTMLElement;
  renderMode?: 'webgl' | 'webgpu';
  qualityLevel?: QualityMode;
}

export class FuseRenderer {
  renderer: WebGLRenderer | WebGPURenderer;
  container: HTMLElement;
  width: number;
  height: number;
  qualityLevel: QualityMode;

  environment?: Texture;

  constructor(options: FuseRendererOptions) {
    if (!options.canvas || !(options.canvas instanceof HTMLCanvasElement)) {
      throw new Error('Must provide a valid canvas element');
    }
    this.container = options.container ?? options.canvas.parentElement ?? document.body;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    if (options.renderMode === 'webgpu') {
      this.renderer = new WebGPURenderer({ canvas: options.canvas, antialias: options.antialias });
    } else {
      this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: options.antialias });
      // Enable TSL node material support for WebGLRenderer
      // (WebGPURenderer handles this natively)
      console.log(`Using WebGL renderer adding nodes handler`);
      this.renderer.setNodesHandler(new WebGLNodesHandler());
    }
    this.renderer.setSize(this.width, this.height);  
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    
    this.qualityLevel = options.qualityLevel ?? QualityMode.Medium;

    if (this.qualityLevel >= QualityMode.Medium) {
      this.renderer.toneMapping = ACESFilmicToneMapping; // or whatever you pick
      this.renderer.toneMappingExposure = 1.0;
    }

    window.addEventListener('resize', this._handleResize.bind(this));

    const resizeObserver = new ResizeObserver((entries) => this._handleResize());
    resizeObserver.observe(this.container);
    
    // setTimeout(() => this._handleResize(), 4000);
    // requestAnimationFrame(() => this._handleResize());
  }
  
  _handleResize() {  
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;
    console.log(`width: ${this.width}`);
    this.renderer.setSize(this.width, this.height);  
  }

  async init() {
    if (this.renderer instanceof WebGPURenderer) {
      await this.renderer.init();
    }
  }

  clear() {
    this.renderer.clear();
  }
  
  render(scene: Scene, camera: Camera, fog?: Fog) {
    if (fog) {
      scene.fog = fog;
    }
    this.renderer.render(scene, camera);
  }

  getMaxAnisotropy() {
    if (this.renderer instanceof WebGPURenderer) {
      return this.renderer.getMaxAnisotropy();
    } else if (this.renderer instanceof WebGLRenderer) {
      return this.renderer.capabilities.getMaxAnisotropy();
    }
    return 1;
  }

  generateEnvironment(scene: Scene, sky?: Mesh) {
    if (!this.renderer) {
      throw new Error('Missing renderer');
    }
    if (!sky) return;
  
    const tempScene = new Scene();
    tempScene.add(sky);
    
    // Three.js type definitions for PMREMGenerator haven't been updated to accept WebGPURenderer as a renderer type yet.
    // @ts-expect-error
    const pmrem = new PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(tempScene, 0, 0.1, 10000).texture;
    pmrem.dispose();
    
    // Move sky back to the real scene
    scene.add(sky);

  }
}