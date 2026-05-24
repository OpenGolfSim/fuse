export function seededRandom(seed: number) {
  return function() {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };
}