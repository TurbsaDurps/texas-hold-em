export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatChips(amount) {
  return `※${Math.max(0, Math.round(amount))}p`;
}
