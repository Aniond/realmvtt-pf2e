const initiativeSkill = data.roll?.metadata?.initiativeSkill || "Perception";
// An adversary that ties a PC goes first (gm-tools.js)
const adversaries = data.roll?.metadata?.initiativeAdversaries || [];
const initiativeFor = (isAdversary) =>
  getInitiativeValue(data.roll.total, { faction: isAdversary ? "enemy" : "party" });
if (data.roll?.metadata?.group && data.roll?.metadata?.group.length > 0) {
  data.roll?.metadata?.group.forEach((tokenId) => {
    // The statistic rolled, for self:participant:initiative:stat:<statistic>
    api.setValuesOnTokenById(tokenId, "tokens", {
      "data.initiative": initiativeFor(adversaries.includes(tokenId)),
      "data.initiativeStatistic": initiativeSkill.toLowerCase(),
    });
  });
  api.sendMessage(
    "",
    data.roll,
    [],
    [
      {
        name: `Group Initiative (${initiativeSkill})`,
        tooltip: `Group Initiative Roll with ${initiativeSkill}`,
      },
    ]
  );
} else {
  // The statistic rolled, for self:participant:initiative:stat:<statistic>
  api.setValues({
    "data.initiative": initiativeFor(!!data.roll?.metadata?.initiativeAdversary),
    "data.initiativeStatistic": initiativeSkill.toLowerCase(),
  });
  api.sendMessage(
    "",
    data.roll,
    [],
    [
      {
        name: `Initiative (${initiativeSkill})`,
        tooltip: `Initiative Roll with ${initiativeSkill}`,
      },
    ]
  );
}
