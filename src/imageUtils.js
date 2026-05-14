
export async function getTextureImageData(model, image) {
  const bufferViewIndex = image.bufferView;
  const buffer = await model.parser.getDependency('bufferView', bufferViewIndex);
  const blob = new Blob([buffer], { type: 'image/png' });
  const bitmap = await window.createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { data, width, height };
}