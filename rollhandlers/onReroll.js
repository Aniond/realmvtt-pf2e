const { roll, record } = data;
const metadata = roll?.metadata;
const recordId = metadata?.recordId;
const recordType = metadata?.recordType;

// A familiar or animal companion with no Hero Points of its own spends its
// master's, when the master's token is on the scene (class-extras.js)
const masterToken =
  recordType && recordId && !(record.data?.heroPoints > 0)
    ? findMasterToken(getHeroPointMasterId(record))
    : null;

if (recordType && recordId) {
  // Check if we have hero points
  const heroPoints = record.data?.heroPoints || 0;
  const masterHeroPoints = getHeroPoints(masterToken);
  if (heroPoints > 0) {
    api.setValuesOnRecord(record, { "data.heroPoints": heroPoints - 1 });
    return {
      success: true,
    };
  } else if (masterToken && masterHeroPoints > 0) {
    api.setValuesOnTokenById(masterToken._id, masterToken.recordType, {
      "data.heroPoints": masterHeroPoints - 1,
    });
    api.sendMessage(`${getCreatureName(record)} rerolls with ${getCreatureName(masterToken)}'s Hero Point.`);
    return {
      success: true,
    };
  } else {
    api.showNotification(
      "You do not have any hero points.",
      "red",
      "No Hero Points"
    );
    return {
      success: false,
    };
  }
} else {
  return {
    success: true,
  };
}
