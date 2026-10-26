const initiativeSkill = data.roll?.metadata?.initiativeSkill || "Perception";
if (data.roll?.metadata?.group && data.roll?.metadata?.group.length > 0) {
  data.roll?.metadata?.group.forEach((tokenId) => {
    // The statistic rolled, for self:participant:initiative:stat:<statistic>
    api.setValuesOnTokenById(tokenId, "tokens", {
      "data.initiative": data.roll.total,
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
    "data.initiative": data.roll.total,
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
