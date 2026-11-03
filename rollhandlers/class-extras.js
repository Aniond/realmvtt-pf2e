// Class extras: Hero Points, Rage's temporary Hit Points, panache and an
// oracle's cursebound.
//
//   - Hero Points (Player Core pg. 413; GM Core): a GM chat macro starts a
//     session (each party member has 1, unspent ones are lost) and another
//     awards 1 to the selected characters, up to 3
//   - Rage (Player Core 2): its temporary Hit Points are noted where they came
//     from, and when the encounter ends Rage, the ones left go with it
//   - Temporary Hit Points at turn start: turnStartTempHp modifiers and
//     effect rules (Inexorable Iron) are gained at the start of the
//     creature's turn, once per round
//   - Panache (Player Core 2): a check with the bravado trait (Tumble Through,
//     and the actions a swashbuckler's style gives it, as module roll
//     options) shows Gain Panache on a success, and Panache until the end of
//     your next turn on a failure. A finisher's card has a Lose Panache button
//   - Cursebound (Player Core 2): using an ability with the cursebound trait
//     raises the condition by 1, up to the maximum (2, 3 with Major Curse, 4
//     with Extreme Curse); at the maximum the card says so and leaves it to
//     the GM. Refocus reduces it by 1
//   - Devise a Stratagem (Player Core 2 pg. 103): using it rolls the d20,
//     kept on the investigator until the start of their next turn; the first
//     Strike against the creature they mark takes it as its attack roll
//   - Overdrive (Guns & Gears pg. 16): using it rolls Crafting against the
//     standard DC for your level, with the module's effect for the result to
//     apply, and on a critical failure the fire damage and a 1d4-round
//     recharge
//   - Unstable (Guns & Gears): using an unstable action rolls the DC 15 flat
//     check (13 if legendary in Crafting) and says what happens
//
// The ruleset assists the GM and doesn't police the action economy (#27): no
// warnings for concentrate actions while raging or attacks after a finisher.

// ---------------------------------------------------------------- Hero Points

const HERO_POINTS_MAX = 3;

// A new session: each party member starts with 1 Hero Point (a GM chat
// macro)
function startHeroPointSession() {
  api.getParty((party) => {
    const members = (party || []).filter((member) => member?.recordType === "characters");
    if (members.length === 0) {
      api.showNotification("Open the Party Sheet from the View menu and drag the characters onto it.", "yellow", "Hero Points");
      return;
    }
    members.forEach((member) => api.setValuesOnRecord(member, { "data.heroPoints": 1 }));
    api.sendMessage(
      `**New session:** ${members.map((member) => getCreatureName(member)).join(", ")} each start with 1 Hero Point. Unspent ones from last session are lost.`,
    );
  });
}

// The values for one more Hero Point, or null at the maximum
function getHeroPointAwardValues(creature) {
  const points = getHeroPoints(creature);
  return points >= HERO_POINTS_MAX ? null : { "data.heroPoints": points + 1 };
}

// Awards a Hero Point to each selected character (a GM chat macro)
function awardHeroPoint() {
  const tokens = (api.getSelectedTokens() || [])
    .map((t) => t?.token || t)
    .filter((token) => token?.recordType === "characters");
  if (tokens.length === 0) {
    api.showNotification("Select the characters to award a Hero Point to.", "yellow", "Hero Points");
    return;
  }
  tokens.forEach((token) => {
    const values = getHeroPointAwardValues(token);
    const name = getCreatureName(token);
    if (!values) {
      api.sendMessage(`${name} already has ${HERO_POINTS_MAX} Hero Points, the most a character can have.`, undefined, [], [], token);
      return;
    }
    api.setValuesOnTokenById(token._id, token.recordType, values);
    api.sendMessage(`${name} gains a Hero Point (${values["data.heroPoints"]}).`, undefined, [], [], token);
  });
}

// ---------------------------------------------------------------- Rage

// What a temporary Hit Points writer sets (applyActionTemporaryHitPoints,
// the healing card's macro, Undying Ferocity): the temporary Hit Points and,
// when they're the ones kept, where they came from
function getActionTempHpValues(target, amount, sourceName = "") {
  const oldTempHp = parseInt(target?.data?.tempHp || "0", 10) || 0;
  const values = { "data.tempHp": Math.max(amount, oldTempHp) };
  if (amount >= oldTempHp) values["data.tempHpSource"] = { name: sourceName, amount };
  return values;
}

// When Rage ends: the temporary Hit Points left from it go (Player Core 2).
// They're Rage's while the source says so and there aren't more than it gave
// (a higher amount from something else would have replaced them)
function getRageEndTempHpValues(token) {
  const source = token?.data?.tempHpSource;
  const tempHp = parseInt(token?.data?.tempHp || "0", 10) || 0;
  if (source?.name !== "Rage" || tempHp <= 0 || tempHp > (parseInt(source.amount, 10) || 0)) return null;
  return { "data.tempHp": 0, "data.tempHpSource": null };
}

// The encounter's end, which ends Rage (onEncounterEnd.js): the GM line for
// each creature that loses Rage's temporary Hit Points
function clearRageTempHp(tokens) {
  const lines = [];
  getEncounterTokens(tokens).forEach((token) => {
    if (!getTokenCondition(token, "Rage")) return;
    const values = getRageEndTempHpValues(token);
    if (!values) return;
    api.setValuesOnTokenById(token._id, token.recordType, values);
    // An eidolon and its summoner share the HP (eidolons.js)
    shareHitPoints(token, values);
    lines.push(`${getCreatureName(token)} loses ${token.data.tempHp} temporary Hit Points from Rage.`);
  });
  return lines;
}

// ---------------------------------------- Temporary Hit Points at turn start

// What a creature gains at the start of each of its turns: the highest of
// its turnStartTempHp modifiers and effect rules whose predicates hold
// (Inexorable Iron: in Arcane Cascade, wielding a melee weapon in two
// hands). { amount, source }, or null
function getTurnStartTempHp(creature) {
  if (!creature || isTokenDead(creature)) return null;
  let best = null;
  getEffectsAndModifiersForToken(creature, ["turnStartTempHp"])
    .filter((mod) => mod.active !== false)
    .forEach((mod) => {
      const amount = getHitPointAmount(mod.value);
      if (amount > 0 && (!best || amount > best.amount)) {
        best = { amount, source: mod.name || "" };
      }
    });
  return best;
}

// Turn start (onTurnStart.js): the temporary Hit Points, when they're more
// than the creature has (they don't add up). Once per round, as Next after
// Previous starts the same turn again.
function runTurnStartTempHp(token, round) {
  const gain = getTurnStartTempHp(token);
  if (!gain) return;
  const hasRound = round !== null && round !== undefined;
  if (hasRound && token.data?.turnStartTempHpRound === round) return;
  const oldTempHp = parseInt(token.data?.tempHp || "0", 10) || 0;
  if (gain.amount <= oldTempHp) return;
  const tempHpValues = getActionTempHpValues(token, gain.amount, gain.source);
  const values = hasRound
    ? { ...tempHpValues, "data.turnStartTempHpRound": round }
    : tempHpValues;
  api.setValuesOnTokenById(token._id, token.recordType, values);
  // An eidolon and its summoner share the HP (eidolons.js)
  shareHitPoints(token, tempHpValues);
  const from = gain.source ? ` from ${gain.source}` : "";
  api.sendMessage(
    `${getCreatureName(token)} gains ${gain.amount} temporary Hit Points${from}.`,
    undefined,
    [],
    [],
    token,
  );
  api.floatText(token, `+${gain.amount}`, "#1165ed");
}

// ---------------------------------------------------------------- Panache

// A check with the bravado trait: its own, or one a roll option gives it
// (the module's Panache: item:trait:bravado for action:tumble-through)
function isBravadoCheck(creature, context = {}) {
  if (!context?.action?.name) return false;
  const traits = collectTraitsAndProperties(creature, context);
  return traits.has("item:trait:bravado") || traits.has("bravado");
}

// The skill card's panache lines (skill.js): on a success, Gain Panache; on
// a failure, panache until the end of your next turn; without a DC, both
function getBravadoLines(bravado, degree) {
  if (!bravado?.tokenId) return [];
  const creature = { _id: bravado.tokenId, name: bravado.tokenName || "the swashbuckler" };
  const known = degree !== null && degree !== undefined;
  if (known && degree < 0) return [];
  const lines = ["**Bravado:**"];
  if (!known || degree >= 1) {
    lines.push(
      `${known ? "You gain panache." : "On a success, you gain panache."}`,
      getChatButton("Gain_Panache", creature, "gainPanache(token, false)"),
    );
  }
  if (!known || degree === 0) {
    lines.push(
      `${known ? "You" : "On a failure (not a critical failure), you"} gain panache until the end of your next turn.`,
      getChatButton("Gain_Panache_(until_end_of_next_turn)", creature, "gainPanache(token, true)"),
    );
  }
  return lines;
}

function gainPanache(token, untilNextTurnEnd = false) {
  if (!token) return;
  if (getTokenCondition(token, "Panache")) {
    api.showNotification(`${getCreatureName(token)} already has panache.`, "yellow", "Panache");
    return;
  }
  if (untilNextTurnEnd) {
    api.addEffect(
      "Panache",
      token,
      { value: getEndOfNextTurnValue(token), unit: "end_applier_turn" },
      { value: 1, _id: token._id, name: getCreatureName(token) },
    );
  } else {
    api.addEffect("Panache", token);
  }
}

// A finisher's card (useAction): a button to lose panache after it
function getFinisherButton(action) {
  const token = api.getToken();
  if (!token?._id || !getTraitNameList(action?.data?.traits).includes("finisher")) return "";
  return `\nYou lose your panache after a finisher.\n${getChatButton("Lose_Panache", token, "losePanache(token)")}`;
}

function losePanache(token) {
  const panache = getTokenCondition(token, "Panache");
  if (panache) api.removeEffectById(panache.effect._id, token);
}

// ---------------------------------------------------------------- Cursebound

// The highest cursebound an oracle can reach: 2, 3 with Major Curse, 4 with
// Extreme Curse (the class features, not the level: Oracle Dedication gets
// neither)
function getCurseboundMax(creature) {
  return hasFeatNamed(creature, "Extreme Curse") ? 4 : hasFeatNamed(creature, "Major Curse") ? 3 : 2;
}

function hasCurseboundTrait(item) {
  return getTraitNameList(item?.data?.traits).includes("cursebound");
}

// Using a cursebound ability (useAction, castSpell): cursebound 1 more, or
// the card's line at the maximum. Returns the line
function applyCursebound(item, token = api.getToken()) {
  if (!token || !hasCurseboundTrait(item)) return "";
  const current = getTokenConditionValue(token, "cursebound");
  const max = getCurseboundMax(token);
  if (current >= max) {
    return `\n[gm]${getCreatureName(token)} is already at their maximum cursebound ${max}: a cursebound ability can't be used.[/gm]`;
  }
  api.addEffect("Cursebound", token);
  return `\nCursebound ${current + 1} (maximum ${max}).`;
}

// Refocus reduces cursebound by 1 (Oracular Curse): one instance of the
// stack
function removeCursebound(token, callback) {
  const found = findTokenConditionBySlug(token, "cursebound");
  if (!found) {
    if (typeof callback === "function") callback();
    return "";
  }
  const current = getTokenConditionValue(token, "cursebound");
  // Without an instance index Realm removes every instance: the last one only
  api.removeEffectById(found.effect._id, token, callback, { instanceIndex: Math.max(current - 1, 0) });
  return current > 1 ? ` Cursebound ${current - 1}.` : " No longer cursebound.";
}

// ---------------------------------------------------------------- Investigator and inventor

function isActionNamed(action, name) {
  return String(action?.name || "").trim().toLowerCase() === name.toLowerCase();
}

// Devise a Stratagem: the d20 rolled when it's used, kept on the investigator
// (data.stratagem: { value, round, used }) for the first Strike against the
// creature they mark. The module's action and effect add the Intelligence
// modifier and Strategic Strike against the mark; a skill stratagem uses the
// effect's toggle, not the d20.
function getStratagemUse(action, token = api.getToken()) {
  if (!isActionNamed(action, "Devise a Stratagem") || !token?._id) return "";
  const value = parseInt(api.rollInstant("1d20")?.total, 10) || 1;
  const round = getEncounterState()?.round || 0;
  api.setValuesOnTokenById(token._id, token.recordType, { "data.stratagem": { value, round, used: false } });
  return `\n**Stratagem d20: ${value}.** Attack stratagem: the first Strike against the creature you mark, before your next turn, uses ${value} for its attack roll (a natural 20 or 1 counts). Skill stratagem: you can't Strike it until your next turn, and get +1 to a check about it instead.`;
}

// Whether a creature carries a token mark this attacker applied (Devise a
// Stratagem, Hunt Prey), as the target:mark trait reads it
function hasOwnTokenMark(target, mark, attackerToken, record) {
  const token = target?.token || target;
  return (token?.effects || []).some((effect) =>
    (effect?.rules || []).some((rule) => {
      if (rule?.type !== "tokenMark" || toSlug(String(rule.value || "")) !== mark) return false;
      const appliedBy = token?.effectValues?.[effect._id]?.tokenId;
      return !appliedBy || appliedBy === attackerToken?._id || appliedBy === record?._id;
    }),
  );
}

// The d20 a Strike takes: the investigator's unused stratagem roll, when the
// target carries their Devise a Stratagem mark; else null
function getStratagemD20(record, target, attackerToken = api.getToken()) {
  const stratagem = record?.data?.stratagem ?? attackerToken?.data?.stratagem;
  const value = parseInt(stratagem?.value, 10);
  if (!stratagem || stratagem.used || !Number.isFinite(value)) return null;
  return hasOwnTokenMark(target, "devise-a-stratagem", attackerToken, record) ? value : null;
}

// The stratagem ends at the start of the investigator's next turn, and with
// the encounter
function clearStratagem(token) {
  if (token?._id && (token.data?.stratagem ?? token.record?.data?.stratagem)) {
    api.setValuesOnTokenById(token._id, token.recordType, { "data.stratagem": null });
  }
}

// Overdrive's results: the module's effect to apply for each, by degree
const OVERDRIVE_EFFECTS = { 2: "Overdrive (Critical Success)", 1: "Overdrive (Success)", 0: "Overdrive (Failure)" };

function getCreatureLevel(creature) {
  return parseInt((creature?.data || creature?.record?.data || {}).level, 10) || 1;
}

// The notes the Crafting check shows for each result, with the buttons
function getOverdriveNotes(token) {
  const fence = "```";
  const apply = (effect) =>
    `\n${getChatButton(`Apply_${effect.replace(/[^A-Za-z]+/g, "_").replace(/_+$/, "")}`, token, `api.addEffect(${JSON.stringify(effect)}, token)`)}`;
  const selfDamage = Math.max(1, Math.ceil(getCreatureLevel(token) / 2));
  const damage = `\n${fence}Take_${selfDamage}_Fire_Damage\napplyDamage(null, { total: ${selfDamage}, types: [{ type: "fire", value: ${selfDamage} }], dice: [], metadata: { rollName: "Overdrive", damageType: "fire" } }, false);\n${fence}`;
  const recharge = `\n${getChatButton("Start_Recharge_(1d4_rounds)", token, 'startRecharge(token, "Overdrive", "1d4")')}`;
  return [
    { name: "Critical overdrive", text: `your Strikes deal extra damage equal to your Intelligence modifier for 1 minute.${apply(OVERDRIVE_EFFECTS[2])}`, outcome: [2] },
    { name: "Overdrive", text: `your Strikes deal extra damage equal to half your Intelligence modifier for 1 minute.${apply(OVERDRIVE_EFFECTS[1])}`, outcome: [1] },
    { name: "Overdrive", text: `your Strikes deal 1 extra fire damage for 1 minute; it doesn't change an Overdrive already active.${apply(OVERDRIVE_EFFECTS[0])}`, outcome: [0] },
    { name: "Overdrive", text: `you take ${selfDamage} fire damage (half your level), an active Overdrive ends, and you can't use Overdrive for 1d4 rounds.${damage}${recharge}`, outcome: [-1] },
  ];
}

// Overdrive: the Crafting check against the standard DC for the inventor's
// level, rolled as it's used
function getOverdriveUse(action, token = api.getToken()) {
  if (!isActionNamed(action, "Overdrive") || !token?._id) return "";
  const level = getCreatureLevel(token);
  const dc = getDCForLevel(level);
  rollSkill(token, "crafting", dc, false, 0, 1, "int", true, false, undefined, {
    action: "Overdrive",
    targetNotes: getOverdriveNotes(token),
  });
  return `\nCrafting against DC ${dc}, the standard DC for level ${level}.`;
}

// The unstable flat check: DC 15, or 13 legendary in Crafting
function getUnstableDC(creature) {
  return (parseInt((creature?.data || creature?.record?.data || {}).crafting, 10) || 0) >= 4 ? 13 : 15;
}

// What an unstable check's d20 means: { degree, text }
function getUnstableResult(natural, dc, level) {
  const degree = natural >= dc + 10 ? 2 : natural >= dc ? 1 : natural <= dc - 10 ? -1 : 0;
  if (degree >= 1) return { degree, text: "it holds." };
  const malfunction = "your innovation malfunctions harmlessly (smoke, sparks) and can't be used for unstable actions until you spend 10 minutes retuning it.";
  if (degree === 0) return { degree, text: malfunction };
  return { degree, text: `${malfunction} You take ${Math.max(1, Math.floor((parseInt(level, 10) || 1) / 2))} fire damage (half your level; a minion innovation takes it instead).` };
}

// An unstable action: the flat check, rolled as it's used
function getUnstableUse(action, token = api.getToken()) {
  if (!getTraitNameList(action?.data?.traits).includes("unstable") || !token) return "";
  const dc = getUnstableDC(token);
  const natural = parseInt(api.rollInstant("1d20")?.total, 10) || 1;
  const result = getUnstableResult(natural, dc, getCreatureLevel(token));
  const color = result.degree >= 1 ? "green" : "red";
  return `\n**Unstable (DC ${dc} flat check): [color=${color}]${natural}[/color]**, ${result.text}`;
}
