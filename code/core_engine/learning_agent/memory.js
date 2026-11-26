const pointValueMisconception = 'limit_equals_function_value';
const recentEventLimit = 16;
const recentSourceLimit = 6;

export function projectLearningMemory(events, currentMisconception) {
  const recent = events.slice(-recentEventLimit);
  const pointValueErrors = recent.filter(event => event.phase === 'practice'
    && event.misconception === pointValueMisconception).length;
  const recentSources = recent.flatMap(event => event.agent?.sourceIds ?? []);
  const seenSourceIds = [...new Set(recentSources.reverse())].slice(0, recentSourceLimit);
  return {
    misconception: currentMisconception === pointValueMisconception || pointValueErrors > 0
      ? pointValueMisconception : null,
    pointValueErrors: pointValueErrors + Number(currentMisconception === pointValueMisconception),
    seenSourceIds
  };
}
