const token = data?.token;
const tokenName = token.name || token.record?.name;

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
  undefined,
  {
    initiativeSkill: initiativeSkill,
    // Who rolled, for the tie rule (initiative.js)
    initiativeAdversary: isInitiativeAdversary(token),
  }
);
