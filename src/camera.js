import * as THREE from 'three';
import styles from './css/ui.module.css';


export class CourseMap {
  constructor(width = 200, height = 300) {
    this.width = width;
    this.height = height;
    const mapSize = 40;
    const nearField = 1;
    const farField = 1000;
    
    this.camera = new THREE.OrthographicCamera(-mapSize, mapSize, mapSize, -mapSize, nearField, farField);
    this.camera.position.set(0, 100, 0);
    this.camera.lookAt(0, 0, 0);

    this.container = document.createElement('div');
    this.container.className = styles.mapContainer;
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.header = document.createElement('div');
    this.header.className = styles.mapHeader;
    this.header.textContent = 'Hole 1, Par 4';

    this.canvas = document.createElement('canvas');
    // this.canvas.style = 'position: absolute; left: 10px; bottom: 10px;'
    this.canvas.className = styles.mapCanvas;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.container.append(this.header, this.canvas);

    document.body.append(this.container);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(this.width, this.height);
    if (window?.devicePixelRatio) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
    }
  }

  render(scene) {
    this.renderer.render(scene, this.camera);
  }

  updatePosition(startPoint, endPoint) {
    // const tee = currentHole().waypoints.get('tee');
    // const hole = currentHole().waypoints.get('hole');

    // Center camera between tee and hole
    const mid = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
    this.camera.position.set(mid.x, 200, mid.z);

    // Rotate so tee→hole runs bottom-to-top on screen
    const dir = new THREE.Vector3().subVectors(endPoint, startPoint);
    dir.y = 0;
    const dist = dir.length();
    dir.normalize();

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

export class ShotPerspectiveCamera extends THREE.PerspectiveCamera {
  constructor(fov, near, far) {
    const aspect = (window.innerWidth / window.innerHeight);
    super(fov, aspect, near, far);
    
    this.shotDirection = new THREE.Vector3();
    this.staticCamPos = new THREE.Vector3();
    this.staticLookAt = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();
    this.desiredCamPos = new THREE.Vector3();
    this.desiredLookAt = new THREE.Vector3();

    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);

    this.aimSpeed = 20; // meters per second
    this.aimKeys = { left: false, right: false, forward: false, backward: false };    
  }

  setPositions(startPoint, aimPoint) {
    const back = new THREE.Vector3().subVectors(startPoint, aimPoint).normalize();
    this.staticCamPos.copy(startPoint).addScaledVector(back, 4);
    this.staticCamPos.y += 1.0;
    this.staticLookAt.copy(aimPoint);

    this.position.copy(this.staticCamPos);
    this.currentLookAt.copy(this.staticLookAt);
    this.lookAt(this.currentLookAt);

    // Lock in the downrange direction for the whole shot.
    // Horizontal only so camera height stays stable.
    this.shotDirection.subVectors(aimPoint, startPoint);
    this.shotDirection.y = 0;
    this.shotDirection.normalize();
  }

  updateAim(dt, startPoint, aimPoint) {
    const { left, right, forward, backward } = this.aimKeys;
    if (!(left || right || forward || backward)) return false;

    const dist = startPoint.distanceTo(aimPoint);
    const angleStep = this.aimSpeed * dt * (Math.PI / 180); // degrees per second

    // Lateral: rotate aim point around start point
    if (left || right) {
      const angle = left ? angleStep : -angleStep;
      const offset = new THREE.Vector3().subVectors(aimPoint, startPoint);
      offset.applyAxisAngle(this._up, angle);
      aimPoint.copy(startPoint).add(offset);
    }

    // Forward/backward: move aim closer or further along the line
    if (forward)  aimPoint.addScaledVector(this.shotDirection,  dist * angleStep);
    if (backward) aimPoint.addScaledVector(this.shotDirection, -dist * angleStep);

    this.setPositions(startPoint, aimPoint);
    return true;
  }




  update(dt, golfBall, startPoint, aimPoint) {
    if (dt && golfBall.isShotTracking) {
      const posSmooth  = 1 - Math.exp(-dt * 2.5);
      const lookSmooth = 1 - Math.exp(-dt * 3.5);
      const tmpBack = new THREE.Vector3().copy(this.shotDirection).negate();

      this.desiredCamPos.copy(golfBall.object.position).addScaledVector(tmpBack, 6);
      this.desiredCamPos.y += 2.5;
      this.desiredLookAt.copy(golfBall.object.position);

      this.position.lerp(this.desiredCamPos, posSmooth);
      this.currentLookAt.lerp(this.desiredLookAt, lookSmooth);
      this.lookAt(this.currentLookAt);
    } else {
      // Only allow aiming when no shot is active
      if (!golfBall.isShotActive) {
        const aimChanged = this.updateAim(dt, startPoint, aimPoint);
        if (aimChanged) {
          return true; // tell caller to refresh UI
        }
      }
      this.position.copy(this.staticCamPos);
      this.lookAt(this.staticLookAt);
    }
    return false;

    // if (dt && golfBall.isShotTracking) {
    //   console.log('trcack it!');
    //   const posSmooth  = 1 - Math.exp(-dt * 2.5);
    //   const lookSmooth = 1 - Math.exp(-dt * 3.5);
    //   const tmpBack = new THREE.Vector3();

    //   // Fixed "behind" vector — opposite of the shot direction.
    //   tmpBack.copy(this.shotDirection).negate();

    //   this.desiredCamPos.copy(golfBall.object.position).addScaledVector(tmpBack, 6);
    //   this.desiredCamPos.y += 2.5;

    //   this.desiredLookAt.copy(golfBall.object.position);

    //   this.position.lerp(this.desiredCamPos, posSmooth);
    //   this.currentLookAt.lerp(this.desiredLookAt, lookSmooth);
    //   this.lookAt(this.currentLookAt);
    // } else {
    //   this.desiredCamPos.copy(this.staticCamPos);
    //   this.desiredLookAt.copy(this.staticLookAt);
    //   this.position.copy(this.desiredCamPos);
    //   this.lookAt(this.desiredLookAt);
    // }

  }
}