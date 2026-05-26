<img src="https://coursedata.opengolfsim.com/webgl/assets/fuse.png" width="300" />

---

FUSE (Fast Universal Simulator Engine) is [OpenGolfSim](https://opengolfsim.com/)'s lightweight 3D golf simulation and physics engine. Providing components and utilities for golf physics, rendering, and camera systems golf simulator in any WebGL-capable browser or device.

Download and install OpenGolfSim Desktop or Mobile, to see the engine in action, connect, and send shots your launch monitor.

> <small>This software is licensed under the PolyForm Noncommercial License 1.0.0. For commercial use, please contact us at help@opengolfsim.com.</small>

---
### 🚀 [Examples](https://github.com/OpenGolfSim/fuse/tree/main/public/games) - 📖 [Docs](https://help.opengolfsim.com) - 🛟 [Support](https://help.opengolfsim.com/connect-with-us)

<img src="https://coursedata.opengolfsim.com/webgl/courses/mountain-vista/v1/mountain-vista-poster.jpg" />

#### Features:

- Real-time ball flight and ground physics
- Custom materials and shaders (grass, sand, water, etc.)
- Aim and keyboard controls
- Practice range mode
- Full course play (multiplayer support)
- Custom courses built via CourseStudio
- SDK for fully custom games

Powered by [Three.js](https://threejs.org/) + [Rapier](https://rapier.rs/).

---

## Custom Courses

We have an all-in-one tool called **CourseStudio** for building courses that work with the built-in course player. If you are just getting started or want to build your own custom course, that's the best place to start.

### Custom Games

You can also build fully custom games or simulator environments for FUSE using it as an SDK.

There are a couple ways to develop your own games locally.

### Option A: Run in OpenGolfSim Desktop

You can build and test games that live on your local filesystem and run inside OpenGolfSim Desktop, with just a few simple steps.

  <!-- - First you'll need to register for a developer account (reach out on our [Discord](https://help.opengolfsim.com/connect-with-us/)) -->

  1. First, create a new folder for your project in the OpenGolfSim `developer` directory

      **Windows**
      ```
      %USERPROFILE%\AppData\Roaming\opengolfsim-desktop\developer\MyAwesomeGame
      ```
      
      **Mac**
      ```
      ~/Library/Application Support/opengolfsim-desktop/developer/MyAwesomeGame
      ```

  1. Add a `game.json` file to your project folder. This will act as the manifest for your game.

      ```
      {
        "name": "my-awesome-game",
        "version": "0.0.1",
        "title": "My Awesome Game",
        "description": "A custom golf simulator game for OpenGolfSim"
      }
      ```

      - `name`: Create a unique name to use as your game ID
      - `version`: The current version of your game
      - `title`: The formatted title that will be displayed to users
      - `description`: A brief description of your game that will be displayed to users

  1. Add an `index.html` file, which will be the entrypoint of your game.

  1. Launch OpenGolfSim Desktop and you should see your game displayed in your game library.

  From here, you'll want to review our SDK documentation to learn how to initialize the game and receive shots from OpenGolfSim.

---
### Option B: Build & Run From Source

You can checkout this repo to build and run our examples or develop your game against the source code, right in the browser.

1. Checkout this repo:

    ```bash
    git checkout https://github.com/OpenGolfSim/fuse.git
    cd fuse
    ```

1. Install the dependencies
    
    ```bash
    npm install
    ```


1. Then run the development server:

    ```bash
    npm start
    ```

    You should now be able to see and run the examples in your browser at: `http://localhost:3112`



