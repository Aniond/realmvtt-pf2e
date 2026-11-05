// Cover (Player Core pg. 424), detected with api.getCover: walls, closed doors
// and windows, terrain, and on 3D scenes floors and props that block vision.
// PF2e draws one line from the center of the attacker's space to the center of
// the target's (method "center"):
//   - The map gives standard cover (+2 circumstance bonus to AC), greater
//     cover (+4), or total cover (can't be targeted).
//   - A creature on that line gives lesser cover (+1), or standard cover (+2)
//     when it's two or more sizes larger than both the attacker and the
//     target. getCover lists the creatures; whether they count is ours to say.
//   - Only the best one applies; they're all circumstance bonuses.
// Strike and spell attack prompts offer it as an unticked modifier: the AC it
// adds, as a penalty to the roll (a -1 to the roll is +1 AC for every degree
// of success). Cover is the GM's call, so it only counts when someone ticks
// it, and it adds only what it beats of the target's circumstance bonuses to
// AC (a raised shield), which don't stack.
// Skipped when the target already has an effect whose name starts with
// "Cover": the GM placed it by hand, and its own bonus takes over.
// The "Cover Notice" campaign setting floats the detected cover over the
// target.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

const COVER_LEVELS = {
  lesser: { label: "Lesser Cover", ac: 1, rank: 1 },
  standard: { label: "Standard Cover", ac: 2, rank: 2 },
  greater: { label: "Greater Cover", ac: 4, rank: 3 },
  full: { label: "Total Cover", ac: 0, rank: 4 },
};

// A size, as an index into CREATURE_SIZES (medium when unknown)
function getSizeIndex(size) {
  const index = CREATURE_SIZES.indexOf(String(size || "medium").toLowerCase());
  return index === -1 ? CREATURE_SIZES.indexOf("medium") : index;
}

function getTokenSizeIndex(token) {
  return getSizeIndex(token?.data?.size || token?.record?.data?.size);
}

// An effect the GM placed by hand ("Cover", "Cover (Greater)")
function hasCoverEffect(token) {
  return (token?.effects || []).some((effect) =>
    /^cover/i.test(String(effect?.name || "").trim()),
  );
}

// The creatures getCover found on the center line that give cover. Dead
// creatures, hazards, vehicles and tokens hidden from the players don't
// count.
function getCreaturesInTheWay(cover, otherTokens) {
  return (cover?.creatures || []).filter((creature) => {
    if (!creature?.centerLine) return false;
    const token = (otherTokens || []).find((t) => t?._id === creature.tokenId);
    if (!token) return true;
    if (token.visible === false) return false;
    const recordType = token.recordType || token.record?.recordType;
    if (recordType === "hazards" || recordType === "vehicles") return false;
    return !getTokenCondition(token, "dead");
  });
}

// The cover between an attacker and a target, as { degree, names } (names:
// the creatures giving it), or null when there's none, it can't be measured,
// or the GM placed a Cover effect
function getDetectedCover(attackerToken, targetToken, otherTokens) {
  if (!attackerToken || !targetToken || hasCoverEffect(targetToken)) return null;
  const cover = api.getCover(attackerToken, targetToken, { method: "center" });
  if (!cover) return null;
  const rankOf = (degree) => COVER_LEVELS[degree]?.rank || 0;
  let degree = COVER_LEVELS[cover.degree] ? cover.degree : "none";
  let names = [];

  const tokenOf = (creature) =>
    (otherTokens || []).find((t) => t?._id === creature.tokenId);
  const inTheWay = getCreaturesInTheWay(cover, otherTokens);
  if (inTheWay.length > 0) {
    const larger =
      Math.max(getTokenSizeIndex(attackerToken), getTokenSizeIndex(targetToken)) + 2;
    const huge = inTheWay.filter((creature) => {
      const token = tokenOf(creature);
      return (token ? getTokenSizeIndex(token) : getSizeIndex(creature.size)) >= larger;
    });
    const creatureDegree = huge.length > 0 ? "standard" : "lesser";
    if (rankOf(creatureDegree) > rankOf(degree)) {
      degree = creatureDegree;
      const giving = huge.length > 0 ? huge : inTheWay;
      names = [
        ...new Set(
          giving.map((creature) => {
            const token = tokenOf(creature);
            return token ? getTokenDisplayName(token) : creature.name;
          }),
        ),
      ];
    }
  }
  return COVER_LEVELS[degree] ? { degree, names } : null;
}

// The best circumstance bonus already in a creature's AC against this
// attacker: its modifiers and effects (Outwit's) and a raised shield
function getBestCircumstanceAcBonus(token, attackerToken, attackContext) {
  const attackRange = String(attackContext?.attackRange || "").toLowerCase();
  const originAtoms = [
    ...(attackerToken ? getOriginAtoms(token, attackerToken) : []),
    ...(attackRange ? [`origin:item:${attackRange}`] : []),
  ];
  const values = getEffectsAndModifiersForToken(
    token,
    ["armorClassBonus", "allBonus"],
    ["dex", "ac"],
    undefined,
    undefined,
    { ...(attackContext || {}), originAtoms },
  )
    .filter((mod) => mod.active && mod.type === "circumstance")
    .map(getModifierSortValue);
  return Math.max(0, getRaisedShieldAcBonus(token), ...values);
}

// The detected cover, as an unticked modifier for the attack's roll prompt
// ([] when there's none, it's total, or the target's circumstance bonus to AC
// is already as good). Floats the cover over the target unless the Cover
// Notice setting is off.
function getCoverModifiers(
  targetToken,
  attackerToken,
  otherTokens,
  attackContext = null,
) {
  const cover = getDetectedCover(attackerToken, targetToken, otherTokens);
  if (!cover) return [];
  const level = COVER_LEVELS[cover.degree];
  if (api.getSetting("coverNotice") !== "no") {
    api.floatText(
      targetToken,
      level.label,
      cover.degree === "full" ? "#e03131" : "#f59f00",
    );
  }
  if (cover.degree === "full") return [];
  const difference =
    level.ac - getBestCircumstanceAcBonus(targetToken, attackerToken, attackContext);
  if (difference <= 0) return [];
  const source =
    cover.names.length > 0 ? `: ${cover.names.join(", ")} in the way` : "";
  return [
    {
      name: `Target AC +${difference} (${level.label}${source})`,
      type: "",
      value: -difference,
      active: false,
      isPenalty: true,
    },
  ];
}
