// Cover from creatures in the way (Player Core pg. 424): a line from the
// center of the attacker's space to the center of the target's that passes
// through a creature gives the target lesser cover, a +1 circumstance bonus to
// AC. A creature two or more sizes larger than both the attacker and the
// target gives standard cover (+2) instead.
//   - Strike and spell attack prompts offer it as an unticked modifier: the
//     AC it adds, as a penalty to the roll (a -1 to the roll is +1 AC for
//     every degree of success). It's a reminder: cover is the GM's call, so
//     it only counts when someone ticks it.
//   - It adds only what it beats of the target's circumstance bonuses to AC
//     (a raised shield, the Cover effect), which don't stack.
// Walls and terrain aren't checked: the Cover effect is for those.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

const LESSER_COVER_BONUS = 1;
const STANDARD_COVER_BONUS = 2;

// A token's size, as an index into CREATURE_SIZES (medium when unknown)
function getTokenSizeIndex(token) {
  const size = String(
    token?.data?.size || token?.record?.data?.size || "medium",
  ).toLowerCase();
  const index = CREATURE_SIZES.indexOf(size);
  return index === -1 ? CREATURE_SIZES.indexOf("medium") : index;
}

// The part of the line from a to b inside a token's space (a square of side
// size, around center), as [enter, exit] fractions of the line, or null.
// inset shrinks the space, so a line along its edge or through its corner
// doesn't count.
function getLineSpanInSpace(a, b, center, size, inset = 0) {
  const half = size / 2 - inset;
  if (!a || !b || !center || half <= 0) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Liang-Barsky: clip the line to the square
  let enter = 0;
  let exit = 1;
  const edges = [
    [-dx, a.x - (center.x - half)],
    [dx, center.x + half - a.x],
    [-dy, a.y - (center.y - half)],
    [dy, center.y + half - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return null;
  }
  return [enter, exit];
}

// A token's space on the grid: its center and side in squares
function getTokenSpace(token) {
  return {
    center: getTokenSpaceCenter(token),
    size: getSizeInSquares(CREATURE_SIZES[getTokenSizeIndex(token)]),
  };
}

// The creatures in the way of an attack: tokens whose space the line between
// the attacker's and the target's centers passes through, between leaving
// the attacker's space and reaching the target's (a token overlapping either
// isn't between them). Dead creatures, hazards, vehicles and tokens hidden
// from the players aren't counted.
function getCreaturesInTheWay(attackerToken, targetToken, otherTokens) {
  if (!attackerToken?.position || !targetToken?.position) return [];
  const attacker = getTokenSpace(attackerToken);
  const target = getTokenSpace(targetToken);
  const from = attacker.center;
  const to = target.center;
  const start = getLineSpanInSpace(from, to, attacker.center, attacker.size)?.[1] ?? 0;
  const end = getLineSpanInSpace(from, to, target.center, target.size)?.[0] ?? 1;
  if (end <= start) return [];
  const ids = [attackerToken._id, targetToken._id];
  return (otherTokens || []).filter((token) => {
    if (!token?.position || ids.includes(token._id)) return false;
    if (token.visible === false) return false;
    const recordType = token.recordType || token.record?.recordType;
    if (recordType === "hazards" || recordType === "vehicles") return false;
    if (getTokenCondition(token, "dead")) return false;
    const space = getTokenSpace(token);
    const span = getLineSpanInSpace(from, to, space.center, space.size, 0.05);
    if (!span) return false;
    return Math.min(span[1], end) - Math.max(span[0], start) > 1e-6;
  });
}

// The best circumstance bonus already in a creature's AC against this
// attacker: its modifiers and effects (the Cover effect, Outwit's) and a
// raised shield
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

// The cover the creatures in the way give the target, as an unticked modifier
// for the attack's roll prompt ([] when there are none, or the target's
// circumstance bonus to AC is already as good)
function getCreatureCoverModifiers(
  targetToken,
  attackerToken,
  otherTokens,
  attackContext = null,
) {
  if (!targetToken || !attackerToken) return [];
  const inTheWay = getCreaturesInTheWay(attackerToken, targetToken, otherTokens);
  if (inTheWay.length === 0) return [];
  const larger =
    Math.max(getTokenSizeIndex(attackerToken), getTokenSizeIndex(targetToken)) + 2;
  const huge = inTheWay.filter((token) => getTokenSizeIndex(token) >= larger);
  const isStandard = huge.length > 0;
  const bonus = isStandard ? STANDARD_COVER_BONUS : LESSER_COVER_BONUS;
  const difference =
    bonus - getBestCircumstanceAcBonus(targetToken, attackerToken, attackContext);
  if (difference <= 0) return [];
  const names = [...new Set((isStandard ? huge : inTheWay).map(getTokenDisplayName))];
  return [
    {
      name: `Target AC +${difference} (${isStandard ? "Standard" : "Lesser"} Cover: ${names.join(", ")} in the way)`,
      type: "",
      value: -difference,
      active: false,
      isPenalty: true,
    },
  ];
}
