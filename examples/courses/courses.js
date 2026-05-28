import {
  THREE,
  app,
  AimPoint,
  CourseLight,
  CourseLoader,
  CourseGame,
  CourseKeyboardControls,
  GolfBall,
  GroundPhysics,
  ShotPerspectiveCamera,
  UICourseMap,
  UIShotData,
  UIRangeFinder,
  UIPlayerMenu,
  UIStats,
  UILoadingScreen,
  UnitConversions,
  VolumetricClouds,
 } from '@opengolfsim/fuse';

const gameContext = {
  world: null,
  scene: null,
  renderer: null,
  course: null,
  setupData: null,
  gameData: null,
  timer: new THREE.Timer(),
  startPoint: new THREE.Vector3(0, 0, 0),
  aimPoint: new THREE.Vector3(0, 0, 0)
};

const lights = {};

const defaultSkyColor = 'rgb(192, 215, 241)';
const lightColor = new THREE.Color('rgb(255, 247, 224)');

let trackTimeout;

function launchShot(shot) {
  console.log('[DEBUG] Received new shot data:', shot);
  if (shot.ballSpeed && !gameContext.golfBall.isShotActive) {
    gameContext.shotData.updateShotData(shot);
    gameContext.golfBall.launchShot(shot);
    
    // tracking scale controls how long we wait before tracking a shot between (0-150 MPH)
    const trackingScale = Math.min(shot.ballSpeed / 150, 1);
    gameContext.camera.setTracking(true, trackingScale);
  }
}

function setupNextShot(playerStatus) {
  console.log('Setup next shot with player', playerStatus);

  gameContext.camera.setTracking(false);
  gameContext.startPoint.copy(gameContext.game.startPoint());
  gameContext.aimPoint.copy(gameContext.game.aimPoint());

  gameContext.camera.setPositions(gameContext.startPoint, gameContext.aimPoint);

  // recreate ball after each shot to ensure physics are fully reset
  gameContext.golfBall.reset(gameContext.aimPoint, gameContext.startPoint);  

  aimPointUpdated(true);
  
  gameContext.courseMap.updatePosition(gameContext.startPoint, gameContext.game.pinPoint());
  gameContext.courseMap.updateHole(gameContext.game.activeHole);
  gameContext.playerMenu.update(gameContext.game.currentPlayer());
}

function setupRenderer() {
  gameContext.renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('canvas'), antialias: true });
  gameContext.renderer.setSize(window.innerWidth, window.innerHeight);
  gameContext.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  gameContext.renderer.shadowMap.enabled = true;
  gameContext.renderer.shadowMap.type = THREE.PCFShadowMap;
}

function setupScene() {
  const skyType = gameContext.course?.sceneSettings?.sky?.type;
  const clouds = gameContext.course?.sceneSettings?.sky?.clouds;

  // Base scene
  // TODO: move to course loader?
  gameContext.scene = new THREE.Scene(); 
  gameContext.scene.background = new THREE.Color(clouds?.skyColor ?? defaultSkyColor);

  gameContext.fog = new THREE.Fog(clouds?.fogColor ?? fogColor, 100, 800);
  gameContext.scene.fog = gameContext.fog;

  gameContext.lightGroup = new CourseLight(lightColor);
  gameContext.scene.add(gameContext.lightGroup);

  // Main Camera
  gameContext.camera = new ShotPerspectiveCamera(gameContext.renderer, gameContext.course.getGroundMeshes(), {
    cameraOffsetX: -(gameContext.setupData.cameraOffset / 100),
  });
  
  // Aim point
  gameContext.visualAimPoint = new AimPoint(gameContext.camera, {
    units: gameContext.setupData.units
  });
  gameContext.scene.add(gameContext.visualAimPoint.object);

  // Course Map
  gameContext.courseMap = new UICourseMap({
    units: gameContext.setupData?.units
  });

  // Controls
  gameContext.controls = new CourseKeyboardControls({ testShots: true });
  gameContext.controls.on('aim', aimKeys => {
    gameContext.camera.aimKeys = aimKeys;
  });
  gameContext.controls.on('testShot', launchShot);
  gameContext.controls.on('toggleStats', () => gameContext.stats.toggle());


  // TODO: move to course loader..
  // Sky/Clouds
  gameContext.clouds = new VolumetricClouds(gameContext.camera, {
    radius: 800,
    density: clouds?.density ?? 0.4,
    opacity: clouds?.opacity ?? 0.8,
    scale: clouds?.scale ?? 6,
    skyColor: new THREE.Color(clouds?.skyColor ?? defaultSkyColor),
    cloudColor: clouds?.cloudColor && new THREE.Color(clouds?.cloudColor),
    fogColor: clouds?.fogColor && new THREE.Color(clouds?.fogColor),
    position: new THREE.Vector3(clouds?.position ?? [0, -50, 0])
  });
  gameContext.scene.add(gameContext.clouds.object);
  
  gameContext.shotData = new UIShotData('#shot-data', { units: gameContext.setupData?.units });
  gameContext.rangeFinder = new UIRangeFinder('#top-center', { units: gameContext.setupData?.units });
  gameContext.playerMenu = new UIPlayerMenu('#top-left');
}

/**
 * Manually place ball
 */
function adjustStartPoint(newPosition) {
  console.log('update start', newPosition);
  const ground = gameContext.course.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  gameContext.game.updateStartPoint(newPosition);
  setupNextShot();
}

/**
 * Adjust the aim point
 */
function adjustAimPoint(newPosition) {
  // console.log('update aim', newPosition);
  const ground = gameContext.course.getGroundY(newPosition.x, newPosition.z);
  if (ground) {
    newPosition.y = ground.y;
  }
  gameContext.aimPoint.copy(newPosition);
  gameContext.camera.setPositions(gameContext.game.startPoint(), gameContext.aimPoint);  
  aimPointUpdated(true);
}

/**
 * Called after the aim point has changed
 */
function aimPointUpdated(forced = false) {
  gameContext.distanceToAim = gameContext.startPoint.distanceTo(gameContext.aimPoint);
  gameContext.heightToAim = gameContext.startPoint.y - gameContext.aimPoint.y;
  gameContext.rangeFinder.update(gameContext.distanceToAim, gameContext.heightToAim);
  gameContext.golfBall.aimAt(gameContext.aimPoint);
  if (forced) {
    gameContext.visualAimPoint.reset(gameContext.aimPoint);
  }
}

/**
 * Generates setup data for testing
 */
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
    practiceMode: false,
    puttingEnabled: false,
    gimmesEnabled: true,
    gimmeDistances: [10, 20],
    elevation: 0,
    gameMode: 2,
  }
}


async function handleSetup(payload) {
  console.log('Received setup event', payload);
  gameContext.setupData = payload?.setupData;
  gameContext.gameData = payload?.gameData;
  preLoad();
}

let isLoaded = false;
let isSetup = false;

async function setupFullCourse() {
  if (!gameContext?.setupData) {
    throw new Error('Missing setupData!');
  }
  if (!gameContext?.gameData?.courseUrl) {
    throw new Error('Missing a courseUrl to a GLB in the gameData object');
  }
  setupRenderer();
  
  // load course details and meshes
  gameContext.course = new CourseLoader(app.world, app.rapier, gameContext.setupData, gameContext.loadingScreen.manager);

  await gameContext.course.load(gameContext.gameData.courseUrl);
  
  console.log('Course loaded', gameContext.course);
  console.log('Course settings', gameContext.course.sceneSettings);

  setupScene();

  gameContext.scene.add(gameContext.course.scene);

  gameContext.golfBall = new GolfBall(gameContext.scene, app.world, app.rapier, {
    setupData: gameContext.setupData,
  });
  
  gameContext.game = new CourseGame(gameContext.course, gameContext.golfBall, gameContext.setupData);
  gameContext.game.on('nextShot', setupNextShot);

  setupNextShot();

  // gameContext.playerMenu.update(gameContext.game.currentPlayer());
  gameContext.courseMap.on('updateAim', adjustAimPoint);
  gameContext.courseMap.on('updateStart', adjustStartPoint);
  
}

function preLoad() {
  gameContext.loadingScreen = new UILoadingScreen(document.body);
  gameContext.loadingScreen.on('load', (error) => {
    console.log('POST LOAD', error);
    isLoaded = true;
    if (!error) {
      requestAnimationFrame(animate);
    }
  });
  gameContext.loadingScreen.load(setupFullCourse);
  
  gameContext.stats = new UIStats('#render-stats', { hidden: false }); // start hidden (press S to toggle)
  gameContext.timer.connect(document);  
}


function animate(animDelta) {
  requestAnimationFrame(animate);

  gameContext.stats.begin();
  const delta = gameContext.timer.getDelta();

  if (gameContext.golfBall) {
    gameContext.golfBall.update(delta);
  }

  gameContext.renderer.clear();

  if (gameContext.controls) gameContext.controls.update(delta);
  if (gameContext.clouds) gameContext.clouds.update(delta);

  gameContext.course?.update(delta, gameContext.camera);
  gameContext.game?.update(delta);

  if (gameContext.courseMap) {
    gameContext.courseMap.render(
      gameContext.scene,
      gameContext.game.activeHole,
      {
        ball: gameContext.startPoint,
        aim: gameContext.aimPoint,
      }
    );
  }

  if (gameContext.camera) {
    const aimChanged = gameContext.camera.update(delta, gameContext.golfBall, gameContext.startPoint, gameContext.aimPoint);
    if (aimChanged) aimPointUpdated();
    gameContext.camera.render(gameContext.scene, gameContext.fog);
  }
  if (gameContext.shotData && gameContext.golfBall) {
    gameContext.shotData.updateShotResult(gameContext.golfBall.stats);
  }

  gameContext.visualAimPoint?.update(
    gameContext.aimPoint,
    gameContext.distanceToAim,
    gameContext.heightToAim,
    gameContext.golfBall.isShotActive
  );

  gameContext.stats.end();
  gameContext.timer.update(animDelta);
}

async function initializeDebug() {
  // used for testing as an example course in the browser
  // pass a courseUrl as a query param to load any course URL
  const params = new URLSearchParams(window.location.search);
  const courseUrl = params.get('courseUrl');
  gameContext.setupData = testSetupData();
  gameContext.gameData = { courseUrl };
  if (courseUrl) {
    preLoad();
  }
}

// -- Required setup --
//
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