import {
  WebGLRenderer,
  PCFShadowMap,
  ACESFilmicToneMapping,
  type Camera,
  type Fog,
  type Scene,
} from 'three';
import { QualityMode } from './utils/quality';
import { WebGPURenderer } from 'three/webgpu';

type FuseRendererOptions = {
  canvas: HTMLCanvasElement;
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

  constructor(options: FuseRendererOptions) {

    this.container = options.container ?? options.canvas.parentElement ?? document.body;
    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    if (options.renderMode === 'webgpu') {
      this.renderer = new WebGPURenderer({ canvas: options.canvas, antialias: options.antialias });
    } else {
      this.renderer = new WebGLRenderer({ canvas: options.canvas, antialias: options.antialias });
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
}