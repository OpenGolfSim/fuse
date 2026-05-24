import * as RAPIER_MODULE from '@dimforge/rapier3d-compat';

declare global {
  // Define the type using typeof
  type RapierInstance = typeof RAPIER_MODULE;
}
