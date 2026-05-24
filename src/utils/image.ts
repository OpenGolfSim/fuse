import { type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function getTextureImageData(buffer: BlobPart) {
  // const bufferViewIndex = image.bufferView;
  // const buffer = await model.parser.getDependency('bufferView', bufferViewIndex);
  const blob = new Blob([buffer], { type: 'image/png' });
  const bitmap = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to get 2D context!');
  }
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}