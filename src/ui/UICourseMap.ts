import * as THREE from 'three';
import EventEmitter from 'eventemitter3';
import styles from '@/css/ui.module.css';
import { Hole } from '@/courses/types';
import { UnitConversions } from '@/utils/units';
import { colors } from '@/utils/colors';
import { UIDropDownMenu } from '@/ui/UIDropDownMenu';

type UICourseMapOptions = {
  mapWidthPercent?: number;
  units?: OpenGolfSim.MeasurementUnits;
  holes?: Map<string, Hole>;
}
interface UICourseMapsEvents {
  updateAim: (position: THREE.Vector3) => void;
  updateStart: (position: THREE.Vector3) => void;
}

export class UICourseMap extends EventEmitter {
  mapWidthPercent: number;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  canvasContainer: HTMLElement;
  header: HTMLElement;
  holeText: HTMLElement;
  parText: HTMLElement;
  distText: HTMLElement;
  units: OpenGolfSim.MeasurementUnits;
  holes: Map<string, Hole>;
  canvas: HTMLCanvasElement;
  overlayCanvas: HTMLCanvasElement;
  
  holeDropdown: UIDropDownMenu;

  aspect: number;
  width: number;
  height: number;

  #frameCount = 0;
  #renderInterval = 6; // render every 6th frame


  constructor(options: UICourseMapOptions = {}) {
    super();
    // this.width = width;
    // this.height = height;
    // this.course = course;
    this.units = options.units ?? 'metric';
    this.mapWidthPercent = options.mapWidthPercent ?? 0.25;
    this.holes = options.holes || new Map();
    
    const mapSize = 40;
    const nearField = 10;
    const farField = 1000;
    
    // this.aspect = 3 / 2;
    // this.width = window.innerWidth * 0.15; // 10%
    // this.height = this.width * this.aspect; // 10%
    
    this.camera = new THREE.OrthographicCamera(-mapSize, mapSize, mapSize, -mapSize, nearField, farField);
    this.camera.position.set(0, 100, 0);
    this.camera.lookAt(0, 0, 0);
    this.aspect = 3 / 2;
    this.width = window.innerHeight * this.mapWidthPercent; // 10%
    this.height = this.width * this.aspect; // 10%    

    this.container = document.createElement('div');
    this.container.className = styles.mapContainer;
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.header = document.createElement('div');
    this.header.className = styles.mapHeader;
    
    this.holeText = document.createElement('div');
    this.holeText.className = styles.mapHoleText;
    this.holeText.textContent = 'Hole 1';

    this.parText = document.createElement('div');
    this.parText.className = styles.mapParText;
    this.parText.textContent = 'Par 5';
    
    this.distText = document.createElement('div');
    this.distText.className = styles.mapDistText;
    this.distText.textContent = '225 yd';

    this.header.append(this.holeText, this.parText, this.distText);

    this.canvas = document.createElement('canvas');
    this.canvas.className = styles.mapCanvas;
    
    this.canvasContainer = document.createElement('div');
    this.canvasContainer.className = styles.canvasContainer;

    this.overlayCanvas = document.createElement('canvas');
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.overlayCanvas.className = styles.overlayCanvas;
    
    this.canvasContainer.append(this.canvas, this.overlayCanvas);
    this.container.append(this.header, this.canvasContainer);

    this.overlayCanvas.addEventListener('click', this._handleCanvasClick.bind(this))

    document.body.append(this.container);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(0.5);
    // this.renderer.setSize(this.width, this.height);

    this._handleResize();
    window.addEventListener('resize', this._handleResize.bind(this));

    this.holeDropdown = new UIDropDownMenu({
      anchor: this.holeText,
      placement: 'top',
      menuItems: [...this.holes.values()].map(hole => ({
        label: `Hole ${hole.number}`,
        secondary: `Par ${hole.par}`,
        action: () => console.log("EXIT")
      })),
        // { label: 'Hole 1', action: () => console.log("EXIT") },
        // { label: 'Hole 2', action: () => console.log("EXIT") },
        // { label: 'Hole 3', action: () => console.log("EXIT") },
      // ]
    });
  }

  _handleResize() {
    
    this.width = window.innerHeight * this.mapWidthPercent; // 10%
    this.height = this.width * this.aspect; // 10%    

    this.container.style.display = this.width < 120 ? 'none' : 'block';

    this.canvas.width = this.overlayCanvas.width = this.width;
    this.canvas.height = this.overlayCanvas.height = this.height;
    this.renderer.setSize(this.width, this.height);

    if (window?.devicePixelRatio) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    }
  }


  updateHole(currentHole: Hole) {
    this.holeText.textContent = `Hole ${currentHole.number}`;
    this.parText.textContent = `Par ${currentHole.par}`;
    const tee = currentHole.waypoints.get('tee');
    const pin = currentHole.waypoints.get('pin');

    const unitText = this.units === 'imperial' ? 'YD' : 'm';
    
    if (tee && pin) {
      const dist = tee.distanceTo(pin);
      let distanceValue = dist;
      if (this.units === 'imperial') {
        distanceValue = UnitConversions.metersToYards(distanceValue);
      }
      this.distText.textContent = `${distanceValue.toFixed(0)} ${unitText}`;
    } else {
      this.distText.textContent = '';
    }
  }

  render(scene: THREE.Scene, currentHole: Hole, currentPositions: { ball?: THREE.Vector3, aim?: THREE.Vector3 } = {}) {
    this.#frameCount++;
    if (this.#frameCount % this.#renderInterval !== 0) return;

    scene.fog = null;
    this.renderer.render(scene, this.camera);

    // render overlay
    const ctx = this.overlayCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('Unable to get map overlay canvas context');
    }
    ctx.clearRect(0, 0, this.width, this.height);
    // const stsartPosition = currentHole?.waypoints?.get('pin');
    const ballPosition = currentPositions.ball ?? currentHole?.waypoints?.get('tee');
    const aimPosition = currentPositions.aim ?? currentHole?.waypoints?.get('aim');
    const pinPosition = currentHole?.waypoints?.get('pin');

    if (ballPosition) {
      this.#drawDot(ctx, ballPosition, colors.white);
    }
    if (aimPosition) {
      const aimDist = ballPosition ? aimPosition.distanceTo(ballPosition) : 0;
      this.#drawDot(ctx, aimPosition, colors.yellow, aimDist);
    }
    if (pinPosition) {
      const aimPinDist = aimPosition ? aimPosition.distanceTo(pinPosition) : 0;
      const pinDist = aimPinDist > 20 && ballPosition ? pinPosition.distanceTo(ballPosition) : 0;
      this.#drawDot(ctx, pinPosition, colors.red, pinDist);
    }
  }

  #drawDot(ctx: CanvasRenderingContext2D, position: THREE.Vector3, color: string = '#e9c834', distanceMeters = 0) {
    const startXY = this._worldToMinimap(position);

    if (distanceMeters) {
      // this._drawDistance(ctx, position, 'rgba(0, 0, 0, 0.6)', distanceMeters, [1, 12]);
      this.#drawDistanceLabel(ctx, position, '#fff', distanceMeters);
    }

    // tee marker
    ctx.beginPath();
    const viewHeight = window.innerHeight * 0.006;
    ctx.arc(startXY.x, startXY.y, viewHeight, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    
  }

  #drawDistanceLabel(ctx: CanvasRenderingContext2D, position: THREE.Vector3, color: string, distanceMeters: number) {
    const startXY = this._worldToMinimap(position);
    const viewHeight = window.innerHeight * 0.012;
    const padding = viewHeight * 1.005; // 10% extra padding
    const offsetY = window.innerHeight * 0.01;

    ctx.font = `normal ${viewHeight}px Rubik,Arial,Helvetica,sans-serif`;
    let distanceUnits = 'm';
    if (this.units === 'imperial') {
      distanceMeters = UnitConversions.metersToYards(distanceMeters);
      distanceUnits = '';
    }
    const text = `${distanceMeters.toFixed(0)} ${distanceUnits}`;
    const metrics = ctx.measureText(text);
    const textWidth = Math.ceil(metrics.width + padding);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + padding;


    ctx.beginPath();
    ctx.roundRect(startXY.x - (textWidth/2), startXY.y + offsetY - (padding/2), textWidth, textHeight, 4);
    ctx.fillStyle = colors.background;
    ctx.fill();

    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = "top";
    ctx.fillText(text, startXY.x, startXY.y + offsetY, textWidth);
  }

  _worldToMinimap(position: THREE.Vector3) {
    const v = position.clone().project(this.camera);
    // project() gives normalized device coords (-1 to 1)
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height  // flip Y for canvas
    };
  }
  
  _minimapToWorld(event: PointerEvent): THREE.Vector3 {
    const rect = this.overlayCanvas.getBoundingClientRect();
    // Convert click to normalized device coords (-1 to 1)
    const ndc = new THREE.Vector3(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
      0
    );
    ndc.unproject(this.camera);
    // Camera looks straight down, so just grab x/z and use ground height
    return new THREE.Vector3(ndc.x, 0, ndc.z);
  }

  _handleCanvasClick(event: PointerEvent) {
    console.log('CLICK', event);
    const pos = this._minimapToWorld(event);
    console.log('POS', pos);

    if (event.shiftKey) {
      this.emit('updateStart', pos);
    } else {
      this.emit('updateAim', pos);
    }
  }

  updatePosition(startPoint: THREE.Vector3, endPoint: THREE.Vector3) {
    // const tee = currentHole().waypoints.get('tee');
    // const hole = currentHole().waypoints.get('hole');

    // Center camera between tee and hole
    const mid = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
    
    this.camera.position.set(mid.x, 200, mid.z);

    // Rotate so tee→hole runs bottom-to-top on screen
    const dir = new THREE.Vector3().subVectors(endPoint, startPoint);
    dir.y = 0;
    let dist = dir.length();
    dir.normalize();
    if (dist < 20) {
      dist = 20;
    }

    this.camera.up.set(dir.x, 0, dir.z);
    this.camera.lookAt(mid.x, 0, mid.z);

    // Size the frustum to fit, respecting your minimap aspect ratio
    const aspect = this.width / this.height; // 200/300
    const padding = 1.2;
    const halfH = (dist / 2) * padding;
    const halfW = halfH * aspect;

    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();

  }
}