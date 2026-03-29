const DEFAULT_FIT_ROLLOUT_PERCENT = 100;

const normalizeString = (value) => String(value || '').trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const buildDeterministicFitBucket = (seed) => {
  const normalizedSeed = normalizeString(seed) || 'fit-default';
  let hashValue = 5381;

  for (let index = 0; index < normalizedSeed.length; index += 1) {
    hashValue = ((hashValue << 5) + hashValue + normalizedSeed.charCodeAt(index)) >>> 0;
  }

  return hashValue % 100;
};

const isFitRolloutActiveForProduct = ({ productId, rolloutPercent = DEFAULT_FIT_ROLLOUT_PERCENT }) => {
  const normalizedPercent = Number.isFinite(Number(rolloutPercent))
    ? clamp(Math.round(Number(rolloutPercent)), 0, 100)
    : DEFAULT_FIT_ROLLOUT_PERCENT;

  if (!normalizeString(productId)) {
    return false;
  }

  if (normalizedPercent <= 0) {
    return false;
  }

  if (normalizedPercent >= 100) {
    return true;
  }

  return buildDeterministicFitBucket(productId) < normalizedPercent;
};

export { isFitRolloutActiveForProduct };
