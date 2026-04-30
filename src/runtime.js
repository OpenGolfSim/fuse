import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls';
import { Line2 } from 'three/addons/lines/Line2';
import { LineGeometry } from 'three/addons/lines/LineGeometry';
import { LineMaterial } from 'three/addons/lines/LineMaterial';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader';
import { Water } from 'three/addons/objects/Water';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline'

import RAPIER from '@dimforge/rapier3d-compat';
import * as physics from './physics';
import * as ogsUI from './ui';
import { app } from './app';
import { BallTrail } from './ballTrail';
import { GroundUtils } from './groundUtils';
import pkg from '../package.json';
import './base.css';

window.THREE = THREE;
window.OrbitControls = OrbitControls;
window.Line2 = Line2;
window.LineGeometry = LineGeometry;
window.LineMaterial = LineMaterial;
window.GLTFLoader = GLTFLoader;
window.DRACOLoader = DRACOLoader;
window.Water = Water;
window.MeshLineGeometry = MeshLineGeometry;
window.MeshLineMaterial = MeshLineMaterial;

window.RAPIER = RAPIER;

// custom elements
window.BallTrail = BallTrail;
window.GroundUtils = GroundUtils;

window.openGolfSim = {
  _version: pkg.version,
  app,
  physics,
  app,
};

// document.addEventListener('DOMContentLoaded', () => {
//   const uiRoot = document.createElement('div');
//   uiRoot.setAttribute('id', 'ui-root');
//   document.body.prepend(uiRoot);
//   ogsUI.setupDefaultUI(uiRoot);
// });

/**
 * Rapier needs async init before use, so we expose a custom window event (engine.ready)
 * 
 * window.addEventListener('engine.ready', () => {
 *   // three.js + rapier are ready, setup your game
 * })
 */
// that game code can await before doing anything
window.RAPIER_READY = RAPIER.init().then(() => {
  console.log('[runtime] Rapier initialized');
  const readyEvent = new CustomEvent('engine.ready', { detail: {} });
  window.dispatchEvent(readyEvent);
});