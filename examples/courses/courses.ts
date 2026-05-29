import { type World } from '@dimforge/rapier3d-compat';
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
  CoursePlayer,
 } from '@opengolfsim/fuse';


const gameContext: {
  startPoint: THREE.Vector3,
  aimPoint: THREE.Vector3,
  
  // Environment
  timer: THREE.Timer,
  world?: World;
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer,
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
  
  // UI
  shotData?: UIShotData,
  courseMap?: UICourseMap,
  playerMenu?: UIPlayerMenu,
  loadingScreen?: UILoadingScreen,
  rangeFinder?: UIRangeFinder,
  stats?: UIStats,

  // State
  distanceToAim: number,
  heightToAim: number,
} = {
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 0),
  distanceToAim: 0,
  heightToAim: 0
};

const defaultSkyColor = 'rgb(192, 215, 241)';
const defaultFogColor = new THREE.Color('rgb(255, 247, 224)');
const defaultCloudColor = new THREE.Color('rgb(255, 255, 255)');
const lightColor = new THREE.Color('rgb(255, 247, 224)');


function launchShot(shot: OpenGolfSim.Shot) {
  if (!gameContext.golfBall) return;
  console.log('[DEBUG] Received new shot data:', shot);
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

  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall?.reset(gameContext.aimPoint, gameContext.startPoint);  

  aimPointUpdated(true);
  
  gameContext.courseMap?.updatePosition(gameContext.startPoint, gameContext.game.pinPoint());
  gameContext.courseMap?.updateHole(gameContext.game.activeHole);

  gameContext.playerMenu?.update(gameContext.game.activePlayer);
}

function setupRenderer() {
  const canvas = document.getElementById('canvas');
  if (!canvas) throw new Error('Unable to find canvas in HTML. Make sure you create a root canvas element (e.g. <canvas id="canvas"></canvas>)');
  gameContext.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  gameContext.renderer.shadowMap.enabled = true;
  gameContext.renderer.shadowMap.type = THREE.PCFShadowMap;
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
  gameContext.scene.background = new THREE.Color(skyColor);

  gameContext.fog = new THREE.Fog(fogColor, 100, 800);
  gameContext.scene.fog = gameContext.fog;

  gameContext.lightGroup = new CourseLight(lightColor);
  gameContext.scene.add(gameContext.lightGroup);

  // Main Camera
  if (!gameContext.renderer) {
    throw new Error('Renderer does not exist!');
  }
  if (!gameContext.course) {
    throw new Error('Course object does not exist!');
  }
  gameContext.camera = new ShotPerspectiveCamera(
    gameContext.renderer,
    gameContext.course.getGroundMeshes(),
    {
      cameraOffsetX: (gameContext.setupData?.cameraOffset ? -(gameContext.setupData.cameraOffset / 100) : 0),
    }
  );
  
  // Aim point
  gameContext.visualAimPoint = new AimPoint(gameContext.camera, {
    units: gameContext.setupData?.units
  });
  await gameContext.visualAimPoint.load();
  gameContext.scene.add(gameContext.visualAimPoint.object);

  // Course Map
  gameContext.courseMap = new UICourseMap({
    units: gameContext.setupData?.units,
    holes: gameContext.course?.holes
  });

  // Controls
  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    if (gameContext.camera) gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('testShot', launchShot);
  gameContext.controls.on('toggleStats', () => gameContext.stats?.toggle());


  // TODO: move to course loader..
  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: cloudSettings?.density ?? 0.4,
    opacity: cloudSettings?.opacity ?? 0.8,
    scale: cloudSettings?.scale ?? 6,
    skyColor,
    cloudColor,
    fogColor,
    position: new THREE.Vector3(...cloudSettings?.position ?? [0, -50, 0])
  });
  gameContext.scene.add(gameContext.clouds.object);
  
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
  if (!app.world) {
    throw new Error('Physics world does not exist');
  }
  if (!gameContext?.setupData) {
    throw new Error('Missing setupData!');
  }
  if (!gameContext?.gameData?.courseUrl) {
    throw new Error('Missing a courseUrl to a GLB in the gameData object');
  }
  setupRenderer();
  
  // load course details and meshes
  gameContext.course = new CourseLoader(app.world, app.rapier, gameContext.setupData, gameContext.loadingScreen?.manager);

  await gameContext.course.load(gameContext.gameData.courseUrl);
  
  console.log('Course loaded', gameContext.course);
  console.log('Course settings', gameContext.course.sceneSettings);
  if (!gameContext.course.scene) throw new Error('Unable to load course scene');

  // create the initial scene
  await setupScene();
  if (!gameContext.scene) {
    throw new Error('Unable to create main scene (does not exist)');
  }
  
  // add loaded course to the scene
  gameContext.scene?.add(gameContext.course.scene);

  // create the golf ball
  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier, {
    setupData: gameContext.setupData,
  });
  
  // setup course game controller
  gameContext.game = new CourseGame(gameContext.course, gameContext.golfBall, gameContext.setupData);
  gameContext.game?.on('nextShot', (player) => {
    console.log(`A new player (${player.name}) is up!`);
    setupNextShot();
  });

  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });
  gameContext.playerMenu = new UIPlayerMenu('#top-left', { players: gameContext.game?.players || [] });
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
    }
  });

  
  setupNextShot();

  gameContext.courseMap?.on('updateAim', adjustAimPoint);
  gameContext.courseMap?.on('updateStart', adjustStartPoint);
  
}

/**
 * Sets up loading screen and kicks off loading of the course and building the scene
 */
function preLoad() {
  gameContext.loadingScreen = new UILoadingScreen(document.body, { loadingPrefix: 'Loading Course' });
  gameContext.loadingScreen.on('load', (error) => {
    console.log('POST LOAD', error);
    if (!error) {
      requestAnimationFrame(animate);
    }
  });
  gameContext.loadingScreen.load(setupCourse);
  
  gameContext.stats = new UIStats('#render-stats', { hidden: true }); // start hidden (press S to toggle)
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
  gameContext.clouds?.update(delta);

  if (gameContext.camera) gameContext.course?.update(delta, gameContext.camera);

  gameContext.game?.update(delta);

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
      const aimChanged = gameContext.camera?.update(delta, gameContext.golfBall, gameContext.startPoint, gameContext.aimPoint);
      if (aimChanged) {
        aimPointUpdated();
      }
      gameContext.camera?.render(gameContext.scene, gameContext.fog);
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
  // used for testing as an example course in the browser
  // pass a courseUrl as a query param to load any course URL
  const params = new URLSearchParams(window.location.search);
  const courseUrl = params.get('courseUrl');
  if (!courseUrl) {
    throw new Error('No courseUrl provided');
  }
  gameContext.setupData = generateSetupData(2);
  gameContext.gameData = { id: 'web', courseUrl, gameMode: 2 };
  if (courseUrl) {
    preLoad();
  }
  document.getElementById('debug-message')?.setAttribute('style', 'display: block;');
}

// listen for setup event from OpenGolfSim app
app.on('setup', handleSetup);
// listen for shot event from OpenGolfSim app
app.on('shot', launchShot);

// initialize must be called before engaging physics/world
app.initialize(() => {
  // if we passed a test course URL as a query param, we start in debug mode
  if (window.location.search) {
    initializeDebug();
  }
});