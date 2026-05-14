export function extractTintAttribute(geometry) {
  if (!geometry.hasAttribute('color')) return;

  const colorAttr = geometry.getAttribute('color');
  const tintArray = new Float32Array(colorAttr.count);
  let histogram = { zero: 0, low: 0, mid: 0, high: 0, full: 0 };

  for (let i = 0; i < colorAttr.count; i++) {
    const r = colorAttr.getX(i);
    const g = colorAttr.getY(i);
    const b = colorAttr.getZ(i);
    tintArray[i] = 1.0 - Math.min(r, g, b);

    if (tintArray[i] === 0) histogram.zero++;
    else if (tintArray[i] < 0.3) histogram.low++;
    else if (tintArray[i] < 0.7) histogram.mid++;
    else if (tintArray[i] < 1.0) histogram.high++;
    else histogram.full++;
  }

  console.log('tint distribution:', histogram);

  // Also log a few sample vertex colors to verify the data
  for (let i = 0; i < Math.min(5, colorAttr.count); i++) {
    console.log(`  vertex ${i}: r=${colorAttr.getX(i).toFixed(3)} g=${colorAttr.getY(i).toFixed(3)} b=${colorAttr.getZ(i).toFixed(3)} → tint=${tintArray[i].toFixed(3)}`);
  }

  geometry.setAttribute('aTint', new THREE.BufferAttribute(tintArray, 1));
}