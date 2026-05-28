export * as THREE from 'three';

import { AppBridge } from '@/app';

export * from '@/camera';
export * from '@/controls';
export * from '@/trees';
export * from '@/lights';
export * from '@/sky';

// Objects
export * from '@/objects/aimPoint';
export * from '@/objects/ballTrail';
export * from '@/objects/flagStick';
export * from '@/objects/golfBall';

// Shaders
export * from '@/shaders';

// Courses
export * from '@/courses/game';
export * from '@/courses/loader';

// Physics
export * from '@/physics/ballPhysics';
export * from '@/physics/groundPhysics';

// UI
export * from '@/ui';

// Utils
export * from '@/utils/units';
export * from '@/utils/data';

import '@/css/base.css';

export const app = new AppBridge();