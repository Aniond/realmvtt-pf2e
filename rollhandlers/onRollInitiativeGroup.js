const token =
  data?.tokens && data?.tokens.length > 0 ? data?.tokens[0] : undefined;

if (token) {
  const initiativeSkill = getInitiativeSkill(token);

  rollSkill(
    token,
    initiativeSkill.toLowerCase(),
    null,
    false,
    0,
    1,
    "int",
    true,
    true,
    (data?.tokens || []).map((token) => token?._id),
    {
      initiativeSkill: initiativeSkill,
      // The group's sides, for the tie rule (initiative.js)
      initiativeAdversaries: (data?.tokens || [])
        .filter((t) => isInitiativeAdversary(t))
        .map((t) => t?._id),
    }
  );
}
