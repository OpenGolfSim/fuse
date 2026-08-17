import { UIHazardDialog } from '@/ui/UIHazardDialog';
import { QualityMode } from '@/utils/quality';

import {
  THREE,
  app,
  AimPoint,
  CourseLight,
  CourseLoader,
  CourseGame,
  CourseKeyboardControls,
  GolfBall,
  ShotPerspectiveCamera,
  UICourseMap,
  UIShotData,
  UIRangeFinder,
  UIPlayerMenu,
  UIStats,
  UILoadingScreen,
  VolumetricClouds,
  generateSetupData,
  UIMainMenu,
  FuseRenderer,
  UIScorecard,
  AudioPlayer,
  UILaunchMonitor
 } from '@opengolfsim/fuse';

const HoleOutSound = '../sounds/holeout.wav';
const GroundThudSound = '../sounds/thud.wav';
const Ktx2Path = '../ktx2/';

const gameContext: {
  isReady: boolean,
  startPoint: THREE.Vector3,
  aimPoint: THREE.Vector3,
  qualityLevel: QualityMode,
  // Environment
  timer: THREE.Timer,
  scene?: THREE.Scene;
  renderer?: FuseRenderer,
  golfBall?: GolfBall,
  lightGroup?: CourseLight,
  fog?: THREE.Fog,  
  clouds?: VolumetricClouds,

  // Course Data
  setupData?: OpenGolfSim.SetupData,
  gameData?: OpenGolfSim.GameData,
  course?: CourseLoader,
  game?: CourseGame,
  
  // Controls
  camera?: ShotPerspectiveCamera,
  controls?: CourseKeyboardControls
  visualAimPoint?: AimPoint,
  
  // Audio
  audioPlayer?: AudioPlayer,
  // UI
  shotData?: UIShotData,
  courseMap?: UICourseMap,
  playerMenu?: UIPlayerMenu,
  mainMenu?: UIMainMenu,
  launchMonitor?: UILaunchMonitor,
  loadingScreen?: UILoadingScreen,
  rangeFinder?: UIRangeFinder,
  stats?: UIStats,
  dialogs: {
    scorecard?: UIScorecard,
    hazard?: UIHazardDialog,
  },
  // State
  distanceToAim: number,
  heightToAim: number,
} = {
  isReady: false,
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 0),
  qualityLevel: QualityMode.Medium,
  distanceToAim: 0,
  heightToAim: 0,
  dialogs: {}
};

const defaultSkyColor = 'rgb(177, 205, 236)';
const defaultFogColor = 'rgb(255, 247, 224)';
const defaultCloudColor = 'rgb(255, 255, 255)';
// const lightColor = new THREE.Color('rgb(255, 247, 224)');


function launchShot(shot: OpenGolfSim.Shot) {
  if (!gameContext.golfBall) return;

  if (shot.ballSpeed && !gameContext.golfBall.isShotActive) {
    gameContext.shotData?.updateShotData(shot);
    gameContext.golfBall.launchShot(shot);
    
    // tracking scale controls how long we wait before tracking a shot between (0-150 MPH)
    const trackingScale = Math.min(shot.ballSpeed / 150, 1);
    gameContext.camera?.setTracking(true, trackingScale);
  }
}

function setupNextShot() {
  if (!gameContext.game) return;
  
  gameContext.camera?.setTracking(false);
  gameContext.startPoint.copy(gameContext.game.startPoint());
  gameContext.aimPoint.copy(gameContext.game.aimPoint());

  gameContext.camera?.setPositions(gameContext.startPoint, gameContext.aimPoint);
  if (gameContext.camera) {
    gameContext.course?.updateActiveGreen(gameContext.camera, gameContext.game.getActiveHoleNumber());
  }

  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall?.reset(gameContext.aimPoint, gameContext.startPoint, gameContext.game.activeHole.waypoints.get('pin'));

  aimPointUpdated(true);

  gameContext.clouds?.update();

  gameContext.courseMap?.updatePosition(gameContext.startPoint, gameContext.game.pinPoint());
  gameContext.courseMap?.updateHole(gameContext.game.activeHole);

  gameContext.game.autoSelectClub();
  gameContext.playerMenu?.update(gameContext.game.activePlayer);
  app.sendPlayerUpdate(gameContext.game.activePlayer, gameContext.startPoint.toArray());

}

async function setupRenderer() {
  THREE.ColorManagement.enabled = true;
  
  const canvas = document.getElementById('canvas');
  if (!canvas || !(canvas instanceof HTMLCanvasElement)) throw new Error('Unable to find canvas in HTML. Make sure you create a root canvas element (e.g. <canvas id="canvas"></canvas>)');
  gameContext.renderer = new FuseRenderer({
    canvas,
    renderMode: 'webgpu',
    adaptive: true,
    forceWebGL: gameContext.setupData?.backend === 'webgl',
    qualityLevel: gameContext.qualityLevel,
  });

  await gameContext.renderer.init();

  gameContext.camera = new ShotPerspectiveCamera(
    {
      autoPosition: true,
      far: 2000,
      cameraOffsetX: (gameContext.setupData?.cameraOffset ? -(gameContext.setupData.cameraOffset / 100) : 0),
    }
  );
}

async function setupScene() {
  const skyType = gameContext.course?.sceneSettings?.sky?.type;
  const cloudSettings = gameContext.course?.sceneSettings?.sky?.clouds;

  const skyColor = new THREE.Color(cloudSettings?.skyColor ?? defaultSkyColor);
  const fogColor = new THREE.Color(cloudSettings?.fogColor ?? defaultFogColor);
  const cloudColor = new THREE.Color(cloudSettings?.cloudColor ?? defaultCloudColor);

  // Base scene
  // TODO: move to course loader?
  gameContext.scene = new THREE.Scene(); 


  // Main Camera
  if (!gameContext.renderer) {
    throw new Error('Renderer does not exist!');
  }
  if (!gameContext.course) {
    throw new Error('Course object does not exist!');
  }
  if (!gameContext.camera) {
    throw new Error('Camera does not exist!');
  }
  
  
  // if (gameContext.setupData?.qualityLevel && gameContext.setupData?.qualityLevel > QualityMode.Medium) {
  //   gameContext.renderer.setupPostProcessing(gameContext.scene, gameContext.camera);
  // }
  gameContext.renderer.setupPostProcessing(gameContext.scene, gameContext.camera);
}

async function setupControls() {
  // Main Camera
  if (!gameContext.renderer) {
    throw new Error('Renderer does not exist!');
  }
  if (!gameContext.course) {
    throw new Error('Course object does not exist!');
  }
  if (!gameContext.camera) {
    throw new Error('Camera does not exist!');
  }
  if (!gameContext.scene) {
    throw new Error('Scene does not exist!');
  }

  // Aim point
  gameContext.visualAimPoint = new AimPoint(gameContext.camera, {
    units: gameContext.setupData?.units
  });
  await gameContext.visualAimPoint.load();
  gameContext.scene.add(gameContext.visualAimPoint.object);

  // Course Map
  if (!gameContext.course.courseMap) {
    throw new Error('Must pass a map image');
  }
  gameContext.courseMap = new UICourseMap({
    units: gameContext.setupData?.units,
    holes: gameContext.course?.holes,
    map: gameContext.course.courseMap,
    worldSize: gameContext.course.courseSize
  });
  gameContext.courseMap.on('holeChange', (hole) => {
    gameContext.game?.switchHole(hole);
    setupNextShot();
  });

  // Controls
  gameContext.controls = new CourseKeyboardControls({ testShots: true, swipeShots: true });
  gameContext.controls.on('aim', aimKeys => {
    if (gameContext.camera) gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('testShot', launchShot);
  gameContext.controls.on('toggleStats', () => gameContext.stats?.toggle());
  gameContext.controls.on('mulligan', () => gameContext.game?.mulligan());
  gameContext.controls.on('rehit', () => gameContext.game?.rehit());
  gameContext.controls.on('scorecard', () => gameContext.dialogs.scorecard?.toggle());
}

/**
 * Manually place ball
 */
function adjustStartPoint(newPosition: THREE.Vector3) {
  console.log('update start', newPosition);
  const ground = gameContext.course?.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  gameContext.game?.updateStartPoint(newPosition);
  setupNextShot();
}

/**
 * Adjust the aim point
 */
function adjustAimPoint(newPosition: THREE.Vector3) {
  if (!gameContext.game) throw new Error('Course game not setup yet');
  // console.log('update aim', newPosition);
  const ground = gameContext.course?.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  gameContext.aimPoint.copy(newPosition);
  gameContext.camera?.setPositions(gameContext.game.startPoint(), gameContext.aimPoint);

  aimPointUpdated(true);
}

/**
 * Called after the aim point has changed
 */
function aimPointUpdated(forced = false) {
  gameContext.distanceToAim = gameContext.startPoint.distanceTo(gameContext.aimPoint);
  gameContext.heightToAim = gameContext.aimPoint.y - gameContext.startPoint.y;
  gameContext.rangeFinder?.update(gameContext.distanceToAim, gameContext.heightToAim);
  gameContext.golfBall?.aimAt(gameContext.aimPoint);
  if (forced) {
    gameContext.visualAimPoint?.reset(gameContext.aimPoint);
  }
}


async function handleSetup(payload: any) {
  console.log('Received setup event', payload);
  if (!payload?.setupData) throw new Error('No setupData received in setup event!');
  if (!payload?.gameData) throw new Error('No gameData received in setup event!');
  gameContext.setupData = payload?.setupData as OpenGolfSim.SetupData;
  gameContext.gameData = payload?.gameData as OpenGolfSim.GameData;
  preLoad();
}

async function setupCourse() {
  if (!gameContext?.setupData) {
    throw new Error('Missing setupData!');
  }
  if (!gameContext?.gameData?.courseUrl) {
    throw new Error('Missing a courseUrl to a GLB in the gameData object');
  }
  if (typeof gameContext.setupData?.qualityLevel !== 'undefined') {
    gameContext.qualityLevel = gameContext.setupData.qualityLevel;
  }
  
  await setupRenderer();
  
  if (!gameContext.renderer) {
    throw new Error('Missing FuseRenderer!');
  }
  if (!gameContext.camera) {
    throw new Error('Missing ShotCamera');
  }


  // load course details and meshes
  gameContext.course = new CourseLoader(
    gameContext.renderer,
    gameContext.camera,
    {
      setupData: gameContext.setupData,
      qualityLevel: gameContext.qualityLevel,
      manager: gameContext.loadingScreen?.manager,
      meshLoaderOptions: { ktx2Path: Ktx2Path }
    }
  );

  console.log('Creating base scene...');
  // create the initial scene
  await setupScene();
  if (!gameContext.scene) {
    throw new Error('Unable to create main scene (does not exist)');
  }

  await gameContext.course.load(gameContext.gameData.courseUrl, gameContext.scene);
  
  console.log('Course loaded', gameContext.course);
  console.log('Course settings', gameContext.course.sceneSettings);
  if (!gameContext.course.scene) throw new Error('Unable to load course scene');

  gameContext.camera.setScene(gameContext.course.getGroundMeshes());  

  console.log('Loading audio files...');
  // load audio
  gameContext.audioPlayer = new AudioPlayer();
  await gameContext.audioPlayer.load(HoleOutSound);  
  await gameContext.audioPlayer.load(GroundThudSound);

  
  console.log('Adding course scene...');
  // add loaded course to the scene
  gameContext.scene?.add(gameContext.course.scene);


  console.log('Create golf ball...');
  // create the golf ball
  gameContext.golfBall = new GolfBall(gameContext.scene, {
    setupData: gameContext.setupData,
    groundMeshes: gameContext.course.getGroundMeshes()
  });
  // gameContext.golfBall.on('landed', (velocity: number) => {
  //   gameContext.audioPlayer?.play(GroundThudSound, velocity);
  // });
  gameContext.golfBall.on('holedOut', () => {
    gameContext.audioPlayer?.play(HoleOutSound);
  });
  gameContext.golfBall.on('shotEnded', (result) => {
    console.log('result', result);
    if (result.isInWater && !gameContext.setupData?.practiceMode) {
      gameContext.dialogs.hazard?.open();
    }
    app.sendShotResult(
      {
        shot: gameContext.golfBall?.lastShot,
        stats: gameContext.golfBall?.stats,
        player: gameContext.game?.activePlayer.player,
        club: gameContext.game?.activePlayer?.currentClub,
      }
    );
  });

  await setupControls();
  
  if (gameContext.renderer.environment) {
    gameContext.course.updateEnvironment(gameContext.renderer.environment);
  }

  console.log('Setup game logic...');
  // setup course game controller
  gameContext.game = new CourseGame(gameContext.course, gameContext.golfBall, { setupData: gameContext.setupData });
  gameContext.game?.on('nextShot', (player) => {
    console.log(`A new player (${player.name}) is up!`);
    setupNextShot();
  });
  gameContext.game?.on('roundEnded', () => {
    console.log(`The round is over!`);
    gameContext.dialogs.scorecard?.open();
  });
  gameContext.game.on('mulligan', () => {
    gameContext.dialogs.hazard?.close();
  });
  gameContext.game.on('rehit', () => {
    gameContext.dialogs.hazard?.close();
  });
  gameContext.game.on('drop', () => {
    gameContext.dialogs.hazard?.close();
  });

  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });
  gameContext.mainMenu = new UIMainMenu('#top-left');
  gameContext.mainMenu.on('stats', () => gameContext.stats?.toggle());
  gameContext.launchMonitor = new UILaunchMonitor('#lm-status');

  gameContext.dialogs.scorecard = new UIScorecard('#scorecard', {
    players: gameContext.game?.players || [],
    holes: gameContext.course.holes
  });
  gameContext.dialogs.hazard = new UIHazardDialog('#hazard', { preventClose: true });
  gameContext.dialogs.hazard.on('drop', () => {
    gameContext.game?.drop();
  });
  gameContext.dialogs.hazard.on('mulligan', () => {
    gameContext.game?.mulligan();
  });
  gameContext.dialogs.hazard.on('rehit', () => {
    gameContext.game?.rehit();
  });

  gameContext.mainMenu.on('help', () => app.help())
  gameContext.mainMenu.on('exit', () => app.exit())

  gameContext.playerMenu = new UIPlayerMenu('#top-left', { players: gameContext.game?.players || [] });
  gameContext.playerMenu.on('showScorecard', () => {
    // gameContext.dialogs.scorecard?.updateScores();
    gameContext.dialogs.scorecard?.open();
  });
  gameContext.playerMenu.on('selectPlayer', player => {
    // handle player changed
    console.log('select player', player);
    if (gameContext.game) {
      gameContext.game.selectPlayer(player);
    }
  });
  gameContext.playerMenu.on('selectClub', club => {
    console.log('select club', club);
    // handle club change
    if (gameContext.game) {
      gameContext.game.selectClub(club);
      gameContext.playerMenu?.update(gameContext.game.activePlayer);
      app.sendPlayerUpdate(gameContext.game.activePlayer, gameContext.startPoint.toArray());
    }
  });

  console.log('Setting up first shot...');

  setupNextShot();

  gameContext.courseMap?.on('updateAim', adjustAimPoint);
  gameContext.courseMap?.on('updateStart', adjustStartPoint);

  if (gameContext.camera) {
    console.log('Precompiling shaders...');
    await gameContext.renderer.compile(gameContext.scene, gameContext.camera);  
    console.log('Done compiling shaders!');
  }

}

/**
 * Sets up loading screen and kicks off loading of the course and building the scene
 */
function preLoad() {
  // allow override with query param
  const params = new URLSearchParams(window.location.search);
  const qualityParam = params.get('quality');
  if (qualityParam) {
    gameContext.qualityLevel = parseInt(qualityParam, 10);
    if (gameContext.setupData) gameContext.setupData.qualityLevel = gameContext.qualityLevel;
  }
  const practiceParam = params.get('practice');
  if (practiceParam) {
    const practiceMode = practiceParam === '1' || practiceParam === 'true';
    if (gameContext.setupData) gameContext.setupData.practiceMode = practiceMode;
  }
  const stimpParam = params.get('stimp');
  if (stimpParam) {
    const stimpValue = Math.max(Math.min(parseInt(stimpParam, 10), 14), 6);
    console.log(`setting stimp: ${stimpValue}`);
    if (gameContext.setupData && stimpValue) gameContext.setupData.stimpLevel = stimpValue;
  }
  const puttingParam = params.get('putting');
  if (puttingParam) {
    const puttingEnabled = puttingParam === '1' || puttingParam === 'true';
    if (puttingEnabled && gameContext.setupData) gameContext.setupData.puttingEnabled = puttingEnabled;
  }

  const backendParam = params.get('backend');
  if (backendParam === 'webgl') {
    if (gameContext.setupData) gameContext.setupData.backend = 'webgl';
  } else if (backendParam === 'webgpu') {
    if (gameContext.setupData) gameContext.setupData.backend = 'webgpu';
  }

  console.log('[debug] Setup Data', gameContext.setupData);
  gameContext.loadingScreen = new UILoadingScreen(document.body, { loadingPrefix: 'Loading Course' });
  gameContext.loadingScreen.on('load', (error) => {
    gameContext.stats = new UIStats('#render-stats', { hidden: true, renderer: gameContext.renderer?.renderer }); // start hidden (press S to toggle)
    if (!error) {
      requestAnimationFrame(animate);
      gameContext.isReady = true;
      gameContext.renderer?.startAdaptiveResolution();
      app.setLoaded();
    }
  });
  gameContext.loadingScreen.load(setupCourse);
  document.body.style.opacity = '1';
  gameContext.timer.connect(document);  
}


function animate(animDelta: number) {
  requestAnimationFrame(animate);

  gameContext.stats?.begin();
  const delta = gameContext.timer.getDelta();
  
  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }

  gameContext.renderer?.clear();

  gameContext.controls?.update(delta);
  // gameContext.clouds?.update(delta);

  if (gameContext.camera && gameContext.golfBall && gameContext.isReady) {
    gameContext.course?.update(delta, gameContext.camera, gameContext.golfBall, gameContext.game?.getActiveHoleNumber());
  }

  // gameContext.game?.update(delta);

  if (gameContext.scene && gameContext.game) {
    gameContext.courseMap?.render(
      gameContext.scene,
      gameContext.game.activeHole,
      {
        ball: gameContext.startPoint,
        aim: gameContext.aimPoint,
      }
    );
  }

  if (gameContext.golfBall) {
    
    gameContext.shotData?.updateShotResult(gameContext.golfBall.stats);
    
    if (gameContext.scene) {
      if (gameContext.golfBall.isShotActive && gameContext.golfBall.object) {
        gameContext.camera?.track(delta, gameContext.startPoint, gameContext.golfBall.object.position);
      } else {
        const aimChanged = gameContext.camera?.update(delta, gameContext.startPoint, gameContext.aimPoint);
        if (aimChanged) {
          aimPointUpdated();
        }
      }

      if (gameContext.camera) {
        if (gameContext.renderer) {
          gameContext.renderer.adaptiveHold = !!gameContext.golfBall?.isShotActive;
        }
        gameContext.renderer?.render(gameContext.scene, gameContext.camera, gameContext.fog);
      }
    }
  }

  gameContext.visualAimPoint?.update(
    gameContext.aimPoint,
    gameContext.distanceToAim,
    gameContext.heightToAim,
    !!gameContext.golfBall?.isShotActive
  );

  gameContext.stats?.end();
  gameContext.timer.update(animDelta);
}

async function initializeDebug() {
  // used for testing an example course in the browser
  // pass a courseUrl as a query param to load a course
  const params = new URLSearchParams(window.location.search);
  const courseUrl = params.get('courseUrl');
  if (!courseUrl) {
    throw new Error('No courseUrl provided');
  }
  gameContext.setupData = generateSetupData(1);
  gameContext.gameData = { id: 'web', courseUrl, gameMode: 2 };
  if (courseUrl) {
    preLoad();
  }
}

// listen for setup event from OpenGolfSim app
app.on('setup', handleSetup);
// listen for shot event from OpenGolfSim app
app.on('shot', launchShot);

// initialize must be called before engaging physics/world
app.initialize(() => {
  // if we passed a test course URL as a query param, we start in debug mode
  if (app.appType === 'web') {
    initializeDebug();
  }
});