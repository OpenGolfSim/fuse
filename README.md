This is the OpenGolfSim WebGL game core. It bundles Three.js and Rapier, as well as our custom flight physics.

## Getting Started

Checkout this repo:
```bash
git checkout https://github.com/OpenGolfSim/webgl-ogs-core.git
cd webgl-ogs-core
```

Install the dependencies
```bash
npm install
```


Build the core files
```bash
npm run build
```

This will generate the build files in `dist/`

## Run a project

You can run / test a WebGL-based game like so:

```bash
npm run project PATH/TO/PROJECT
```

This should watch and build the webgl-core files in `src/` and serve the static files of your game.