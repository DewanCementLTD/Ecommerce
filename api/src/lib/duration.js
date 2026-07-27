const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

/** @param {string} duration e.g. '15m', '7d' */
export function parseDurationToSeconds(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error(`Invalid duration: "${duration}"`);
  return Number(match[1]) * UNIT_SECONDS[match[2]];
}
