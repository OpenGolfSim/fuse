import { type WebGLRenderer } from 'three';

export enum QualityMode {
  Low = 0,
  Medium = 1,
  High = 2,
};
export function getDefaultQuality(renderer: WebGLRenderer) {
  const gl = renderer.getContext();
  // @ts-expect-error
  const memory = window.navigator.deviceMemory ?? null;
  const cores = window.navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const dpr = window.devicePixelRatio || 1;

  if (!mobile) return 'high';

  // Mobile from here — score based on measurable hardware signals
  let score = 0;
  if (memory === null) score += 1;       // unknown, assume mid
  else if (memory >= 6) score += 2;
  else if (memory >= 4) score += 1;

  if (cores >= 8) score += 2;
  else if (cores >= 6) score += 1;

  if (maxTextureSize >= 16384) score += 1;

  // High-DPI mobile screens suggest flagship devices
  if (dpr >= 3) score += 1;

  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}