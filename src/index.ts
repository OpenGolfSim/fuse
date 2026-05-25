// export * as THREE from 'three';

import { AppBridge } from '@/app';

export * from '@/camera';
export * from '@/controls';
export * from '@/trees';
export * from '@/lights';
export * from '@/map';
export * from '@/sky';

// Objects
export * from '@/objects/aimPoint';
export * from '@/objects/ballTrail';
export * from '@/objects/flagStick';
export * from '@/objects/golfBall';

// Shaders
export * from '@/shaders/water';
export * from '@/shaders/grass';
export * from '@/shaders/grassFlat';
export * from '@/shaders/sand';
export * from '@/shaders/target';
export * from '@/shaders/water';

// Courses
export * from '@/courses/game';
export * from '@/courses/loader';

// Physics
export * from '@/physics/ballPhysics';
export * from '@/physics/groundPhysics';

// UI
export * from '@/ui/UIPlayerMenu';
export * from '@/ui/UIRangeFinder';
export * from '@/ui/UIShotData';
export * from '@/ui/Stats';

// Utils
export * from '@/utils/units';

import '@/css/base.css';

export const app = new AppBridge();