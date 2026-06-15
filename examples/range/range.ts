import { type World } from '@dimforge/rapier3d-compat';
import {
  THREE,
  app,
  AimPoint,
  CourseLight,
  CourseKeyboardControls,
  GolfBall,
  GroundPhysics,
  ShotPerspectiveCamera,
  UIShotData,
  UIRangeFinder,
  UILoadingScreen,
  UIStats,
  UnitConversions,
  VolumetricClouds,
  MeshLoader,
  YardageLinesMaterial,
  FlatGrassShaderMaterial,
  CourseSurfaces,
  generateSetupData,
  CoursePlayer,
  UIPlayerMenu,
  UIMainMenu,
  CourseSurfaceType,
  FuseRenderer
} from '@opengolfsim/fuse';
import rangeMtnsModel from './models/rangeMtns.glb?url';
import fairwayTexture from './textures/gen_fairway_tex.png?url';
import fairwayMap from './textures/gen_fairway_map.png?url';
import { PlayerState } from '@/courses/types';

const sunColor = new THREE.Color('#fffbec');
const skyColor = new THREE.Color('#d5e4e9');
const fogColor = new THREE.Color('#7e9096');
const cloudColor = new THREE.Color('#ffffff');
const mountainColor = new THREE.Color('#687e80');
const hashMarks = [50, 100, 150, 200, 250, 300];

const gameContext: {
  startPoint: THREE.Vector3,
  aimPoint: THREE.Vector3,
  currentPlayer?: CoursePlayer,
  // Environment
  timer: THREE.Timer,
  world?: World,
  scene?: THREE.Scene,
  renderer?: FuseRenderer,
  golfBall?: GolfBall,
  lightGroup?: CourseLight,
  fog?: THREE.Fog,  
  clouds?: VolumetricClouds,
  ground?: THREE.Mesh,
  groundLines?: THREE.Mesh,
  mountain?: THREE.Object3D,
  groundCollider?: GroundPhysics,
  yardageLines?: YardageLinesMaterial,

  // Setup Data
  setupData?: OpenGolfSim.SetupData,  

  // UI
  shotData?: UIShotData,
  loadingScreen?: UILoadingScreen,
  rangeFinder?: UIRangeFinder,
  stats?: UIStats,
  playerMenu?: UIPlayerMenu,
  mainMenu?: UIMainMenu,
  
  // Controls
  camera?: ShotPerspectiveCamera,
  controls?: CourseKeyboardControls,
  visualAimPoint?: AimPoint,

  meshLoader?: MeshLoader,

  // State
  distanceToAim: number,
  heightToAim: number,

} = {
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 200),
  distanceToAim: 0,
  heightToAim: 0,
};

function launchShot(shot: OpenGolfSim.Shot) {
  if (shot.ballSpeed && !gameContext.golfBall?.isShotActive) {
    gameContext.golfBall?.launchShot(shot);
    gameContext.shotData?.updateShotData(shot);
    // start tracking after a delay based on ball speed
    // the default is 3 seconds
    const trackingDelayScale = Math.min(shot.ballSpeed / 150, 1);
    gameContext.camera?.setTracking(true, trackingDelayScale);
  }
}

function setupWorld() {
  gameContext.timer.connect(document);

  const canvas = document.getElementById('canvas');
  if (!canvas || !(canvas instanceof HTMLCanvasElement)) throw new Error('Unable to find canvas in HTML. Make sure you create a root canvas element (e.g. <canvas id="canvas"></canvas>)');
  
  gameContext.renderer = new FuseRenderer({ canvas, antialias: true });
}


async function createGroundPlane() {
  if (!app.world) throw new Error('Missing physics world. Did you call app.initialize() first?');
  if (!gameContext.scene) throw new Error('Missing base scene');
  const rangeWidth = 500;
  const rangeHeight = 700;
  const widthRatio = rangeHeight / rangeWidth;
  const grassScale = 100;

  const textureLoader = new THREE.TextureLoader(gameContext.loadingScreen?.manager);
  const grassTexture = textureLoader.load(fairwayTexture);
  console.log('grassTexture', grassTexture);
  grassTexture.wrapS = THREE.RepeatWrapping;
  grassTexture.wrapT = THREE.RepeatWrapping;
  grassTexture.repeat.set(grassScale, grassScale * widthRatio); // tile 50x across, 100x down the 100x200 plane
  grassTexture.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassTexture.anisotropy = gameContext.renderer?.getMaxAnisotropy() || 1;
  
  const grassNormalMap = textureLoader.load(fairwayMap);
  grassNormalMap.wrapS = THREE.RepeatWrapping;
  grassNormalMap.wrapT = THREE.RepeatWrapping;
  grassNormalMap.repeat.set(grassScale, grassScale * widthRatio); // tile 50x across, 100x down the 100x200 plane
  grassNormalMap.colorSpace = THREE.SRGBColorSpace; // correct color rendering
  grassNormalMap.anisotropy = gameContext.renderer?.getMaxAnisotropy() || 1;
    
  let floorMaterial = new THREE.MeshStandardMaterial({
    name: 'floor',
    map: grassTexture,
    normalMap: grassNormalMap,
    roughness: 1,
    metalness: 0,
  });
  
  
    // Floor - Lighter wood planks
  // const floorGeometry = new THREE.PlaneGeometry(500, 700);
  const floorGeometry = new THREE.PlaneGeometry(rangeWidth, rangeHeight, 50, 70);

  gameContext.ground = new THREE.Mesh(floorGeometry, floorMaterial);
  gameContext.ground.rotation.x = -Math.PI / 2;
  gameContext.ground.position.y = 0;
  gameContext.ground.position.z = 140;
  gameContext.ground.receiveShadow = true;

  // console.log('mat', mat);

  gameContext.scene.add(gameContext.ground);
  
  gameContext.groundLines = gameContext.ground.clone();
  gameContext.groundLines.position.y = 0.001;
  
  gameContext.scene.add(gameContext.groundLines);

  
  gameContext.groundCollider = new GroundPhysics(gameContext.ground, app.world, app.rapier, {
    type: CourseSurfaceType.Fairway,
    ...CourseSurfaces.fairway
  });  


  const downrange = new THREE.Vector3(0, 0, 1); // looking down -Z

  const distances = [...hashMarks].map(val => gameContext.setupData?.units === 'imperial' ? UnitConversions.yardsToMeters(val) : val);

  gameContext.yardageLines = new YardageLinesMaterial(
    gameContext.groundLines,
    gameContext.startPoint,
    downrange,
    distances,
    {
      lineWidth:  0.5,
      lineLength: 50,
      labels: hashMarks,
      lineColor:  [1, 1, 1, 0.5],
      feather:    0.2,   // 10% soft fade at each end
      texelsPerMeter: 40
    }
  );

  // @ts-expect-error
  gameContext.ground.material = new FlatGrassShaderMaterial(gameContext.ground.material, {
    blendNoiseScale: 0.1,
  });


  await loadMountain(grassTexture, grassNormalMap);
}


async function loadMountain(
  grassTexture: THREE.Texture,
  grassNormalMap: THREE.Texture
) {
  gameContext.mountain = await gameContext.meshLoader?.load(rangeMtnsModel, true);
  if (!gameContext.mountain) {
    console.warn('Unable to load mountain mesh!');
    return;
  }

  const mountainMaterial = new THREE.MeshStandardMaterial({
    map: grassTexture,
    normalMap: grassNormalMap,
    roughness: 1,
    color: mountainColor,
    displacementScale: 0.5,
    normalScale: new THREE.Vector2(0, 0.5),
    metalness: 0
  });
  
  const offsetZ = 900;
  // @ts-expect-error
  gameContext.mountain.material = mountainMaterial;
  gameContext.mountain.position.set(0, -12, offsetZ);
  gameContext.mountain.scale.set(20, 20, 20);
  gameContext.scene?.add(gameContext.mountain);
}

async function setupRange() {
  setupWorld();
  const player = gameContext.setupData?.players?.[0];
  if (!player) throw new Error('No player found in setup data');
  if (!player.clubs?.length) throw new Error('No clubs found for player');
  // setup range player
  gameContext.currentPlayer = new CoursePlayer(player);
  console.log('gameContext.currentPlayer', gameContext.currentPlayer)

  if (!gameContext.renderer) {
    throw new Error('Renderer must be created first');
  }
  gameContext.meshLoader = new MeshLoader(gameContext.renderer.renderer, gameContext.loadingScreen?.manager);

  gameContext.scene = new THREE.Scene();
  gameContext.scene.background = skyColor;
  gameContext.lightGroup = new CourseLight(sunColor);
  gameContext.scene.add(gameContext.lightGroup);

  gameContext.fog = new THREE.Fog(fogColor, 200, 1000);
  gameContext.scene.fog = gameContext.fog;

  await createGroundPlane();

  if (!gameContext.renderer) throw new Error('Renderer should exist before creating camera');
  if (!gameContext.ground) throw new Error('Ground physics should exist before creating camera');
  gameContext.camera = new ShotPerspectiveCamera({
    scene: gameContext.ground,
    far: 900,
    cameraOffsetX: gameContext.setupData?.cameraOffset ? -(gameContext.setupData.cameraOffset / 100) : 0
  });

  gameContext.visualAimPoint = new AimPoint(gameContext.camera, {
    units: gameContext.setupData?.units
  });
  await gameContext.visualAimPoint.load();
  gameContext.scene.add(gameContext.visualAimPoint.object);

  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    if (gameContext.camera) gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('toggleStats', () => gameContext.stats?.toggle());
  gameContext.controls.on('testShot', shot => launchShot(shot));
  
  // start hidden (press S to toggle)
  gameContext.stats = new UIStats('#render-stats', { hidden: true });

  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: 0.4,
    opacity: 0.8,
    scale: 6,
    skyColor,
    fogColor,
    cloudColor,
    position: new THREE.Vector3(0, 0, 0)
  });
  gameContext.scene.add(gameContext.clouds.object);
  
  if (!app.world) throw new Error('Missing physics world. Did you call app.initialize() first?');
  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier, {
    setupData: gameContext.setupData,
    clearTrail: 'start'
  });
  gameContext.golfBall.on('shotEnded', onShotEnded);

  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });
  
  console.log('gameContext.setupData?.players', gameContext.setupData?.players);

  gameContext.mainMenu = new UIMainMenu('#top-left');
  gameContext.mainMenu.on('exit', () => app.exit())
  gameContext.playerMenu = new UIPlayerMenu('#top-left', {
    // setupData: gameContext.setupData,
    players: [gameContext.currentPlayer]
  });
  gameContext.playerMenu.on('selectClub', club => clubChange(club));
  
  setupNextShot();

  // if (gameContext.setupData?.players.length) {
  //   gameContext.playerMenu?.update({ player: gameContext.setupData.players[0] });
  // }
}

async function preLoad() {
  gameContext.loadingScreen = new UILoadingScreen(document.body, { loadingPrefix: 'Hitting the range' });
  gameContext.loadingScreen.on('load', () => {
    requestAnimationFrame(animate);
  });
  gameContext.loadingScreen.load(setupRange);
  document.body.style.opacity = '1';
}

function onShotEnded() {
  setupNextShot();

  const update: OpenGolfSim.ShotResultEvent = {
    type: 'result',
    data: gameContext.golfBall?.stats,
    shot: gameContext.golfBall?.lastShot,
    playerId: gameContext.currentPlayer?.id,
    club: gameContext.currentPlayer?.currentClub,

    startPosition: gameContext.startPoint.toArray(),
    endPosition: gameContext.golfBall?.stats.endPosition?.toArray(),
    landPosition: gameContext.golfBall?.stats.landPosition?.toArray(),
    ballTrail: gameContext.golfBall?.getTrailPoints(),
    lateralSamples: gameContext.golfBall?.stats.lateralSamples,
    heightSamples: gameContext.golfBall?.stats.heightSamples,
    distanceSamples: gameContext.golfBall?.stats.distanceSamples,
  }
  console.log('update', update);
  app.sendMessage(update);

}

async function initializeSetup(payload: any) {
  console.log('Received setup event', payload);
  if (!payload?.setupData) throw new Error('No setupData received in setup event!');
  gameContext.setupData = payload?.setupData as OpenGolfSim.SetupData;
  preLoad();
}

async function initializeDebug() {
  gameContext.setupData = generateSetupData(1);
  preLoad();
  document.getElementById('debug-message')?.setAttribute('style', 'display: block;');
}


function testSetupData() {
  const clubs = [
    { fullName: 'Driver', name: 'DR', id: 'DR', distance: 180 },
    { fullName: '5 Iron', name: '5i', id: '5I', distance: 150 },
    { fullName: 'Pitching Wedge', name: 'PW', id: 'PW', distance: 100 },
    { fullName: 'Putter', name: 'P', id: 'PT', distance: 0 }
  ];
  return {
    units: 'imperial',
    players: [
      {
        name: 'Player One',
        id: 'player-1',
        clubs: [...clubs]
      },
      {
        name: 'Player Two',
        id: 'player-2',
        clubs: [...clubs]
      }
    ],
    cameraOffset: 0,
    puttingEnabled: false,
    gimmesEnabled: true,
    gimmeDistances: [10, 20],
    elevation: 0,
    gameMode: 2,
  }
}

function clubChange(club: OpenGolfSim.Club) {
  if (!gameContext.currentPlayer) throw new Error('No active player');
  gameContext.currentPlayer.currentClub = club;
  gameContext.aimPoint = new THREE.Vector3(0, 0, club.distance);
  gameContext.camera?.setPositions(gameContext.startPoint, gameContext.aimPoint);
  gameContext.playerMenu?.update(gameContext.currentPlayer);
  updateAimPoint();
}

function setupNextShot(playerStatus?: CoursePlayer) {
  gameContext.camera?.setTracking(false);
  gameContext.camera?.setPositions(gameContext.startPoint, gameContext.aimPoint);
  gameContext.golfBall?.reset(gameContext.aimPoint, gameContext.startPoint);
  updateAimPoint()
  
  if (gameContext.currentPlayer) gameContext.playerMenu?.update(gameContext.currentPlayer);
}

function updateAimPoint() {
  gameContext.distanceToAim = gameContext.startPoint.distanceTo(gameContext.aimPoint);
  gameContext.heightToAim = gameContext.startPoint.y - gameContext.aimPoint.y;
  gameContext.rangeFinder?.update(gameContext.distanceToAim, gameContext.heightToAim);
  gameContext.golfBall?.aimAt(gameContext.aimPoint);
}

function animate(animDelta: number) {
  requestAnimationFrame(animate);

  gameContext.stats?.begin();  
  const delta = gameContext.timer.getDelta();   

  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }

  gameContext.renderer?.clear();

  if (gameContext.controls) gameContext.controls.update(delta);
  
  if (gameContext.clouds) gameContext.clouds.update(delta);

  
  if (gameContext.scene && gameContext.golfBall) {
    if (gameContext.golfBall.isShotActive && gameContext.golfBall.object) {
      gameContext.camera?.track(delta, gameContext.startPoint, gameContext.golfBall.object.position);
    } else {
      const aimChanged = gameContext.camera?.update(
        delta,
        gameContext.startPoint,
        gameContext.aimPoint
      );
      if (aimChanged) {
        updateAimPoint();
      }
    }
    
    // should come after the camera update
    gameContext.visualAimPoint?.update(gameContext.aimPoint, gameContext.distanceToAim, gameContext.heightToAim, gameContext.golfBall.isShotActive);
  }
  
  if (gameContext.camera && gameContext.scene) {
    gameContext.renderer?.render(gameContext.scene, gameContext.camera, gameContext.fog);
  }
  
  if (gameContext.shotData && gameContext.golfBall) {
    gameContext.shotData.updateShotResult(gameContext.golfBall.stats);
  }
  
  gameContext.stats?.end();
  gameContext.timer.update(animDelta);

}
// use this on load of page, with test data
app.initialize(initializeDebug);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('setup', initializeSetup);
// sent by OpenGolfSim Desktop/Mobile apps
app.on('shot', shot => launchShot(shot));
