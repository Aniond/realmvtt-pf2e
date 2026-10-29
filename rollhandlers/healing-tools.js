// Healing tools: Treat Wounds and Battle Medicine immunity, persistent damage,
// rest options and watches, and fast healing, regeneration and ferocity.
//
//   - Treat Wounds (Player Core pg. 241): the patient is immune to it for 1
//     hour. Battle Medicine (Player Core pg. 258): the patient is immune to
//     that healer's Battle Medicine for 1 day, and it doesn't end wounded.
//     The modules' "Treat Wounds Immunity" and "Battle Medicine Immunity"
//     effects are added with the healer as applier; a healer already
//     immune-blocked gets a warning, nothing is blocked (treatWounds)
//   - Persistent damage (Player Core pg. 450): of one type, only the higher
//     amount applies; particularly appropriate help lowers the flat check's DC
//     to 10; persistent bleed ends at full Hit Points. The recovery check can
//     be rolled automatically (setting persistentRecoveryRoll)
//   - Rest (GM Core pg. 42, 50): no shelter or comfort halves the healing (the
//     GM's call), sleeping in armor without the comfort trait wakes you
//     fatigued, and each full day of long-term rest heals double. Watches
//     (GM Core pg. 43): the night takes 8 hours x n / (n - 1)
//   - Fast healing and regeneration (Monster Core): Hit Points back at the
//     start of the creature's turn. Damage of a listed type turns
//     regeneration off until the end of the creature's next turn, and while
//     it's on the creature's dying value stops at 3 (not dead at 0 HP).
//     Ferocity: a reaction that keeps a monster at 1 HP, wounded + 1

// ------------------------------------------------------- Treat Wounds and Battle Medicine

const MEDICINE_KINDS = {
  treatWounds: {
    kind: "treatWounds",
    label: "Treat Wounds",
    effect: "Treat Wounds Immunity",
    duration: "1 hour",
    perHealer: false,
    endsWounded: true,
  },
  battleMedicine: {
    kind: "battleMedicine",
    label: "Battle Medicine",
    effect: "Battle Medicine Immunity",
    duration: "1 day",
    perHealer: true,
    endsWounded: false,
  },
};

function getMedicineKind(kind) {
  return MEDICINE_KINDS[kind] || MEDICINE_KINDS.treatWounds;
}

// The instances of an effect on a token, one { value, tokenId, tokenName }
// (or plain value) each: effectValues holds an array once there are several
function getEffectInstances(token, effect) {
  if (!effect) return [];
  const count = (token?.effectIds || []).filter((id) => id === effect._id).length || 1;
  const stored = token?.effectValues?.[effect._id];
  if (Array.isArray(stored)) return stored;
  if (stored === undefined || stored === null) return Array(count).fill(null);
  return [stored];
}

// The immunity effect that stops this healing on the target: Treat Wounds
// from anyone, Battle Medicine from this healer (an instance with no applier
// recorded counts, as with marks)
function findMedicineImmunity(target, kind, healerId) {
  const medicine = getMedicineKind(kind);
  const wanted = medicine.effect.toLowerCase();
  const effect = (target?.effects || []).find(
    (e) => `${e?.name || ""}`.trim().toLowerCase() === wanted,
  );
  if (!effect) return null;
  if (!medicine.perHealer) return effect;
  const instances = getEffectInstances(target, effect);
  return instances.some((instance) => {
    const tokenId = instance && typeof instance === "object" ? instance.tokenId : null;
    return !tokenId || tokenId === "null" || tokenId === healerId;
  })
    ? effect
    : null;
}

// A warning for targets already immune to this healing, or ""
function getMedicineImmunityWarning(targets, kind, healer) {
  const medicine = getMedicineKind(kind);
  const immune = (targets || [])
    .map((t) => t?.token || t)
    .filter((t) => findMedicineImmunity(t, kind, healer?._id))
    .map((t) => getCreatureName(t));
  if (immune.length === 0) return "";
  const from = medicine.perHealer ? `${getCreatureName(healer)}'s ${medicine.label}` : medicine.label;
  return `${immune.join(", ")} ${immune.length > 1 ? "are" : "is"} still immune to ${from} (${medicine.duration}).`;
}

// Adds the immunity with the healer as applier, unless the target already
// has it (so the healing and the card's button can both call this)
function applyMedicineImmunity(target, medicine) {
  if (!target || !medicine?.kind) return false;
  if (findMedicineImmunity(target, medicine.kind, medicine.healerId)) return false;
  const { effect } = getMedicineKind(medicine.kind);
  const applier = medicine.healerId
    ? { value: 1, _id: medicine.healerId, name: medicine.healerName || "" }
    : undefined;
  api.addEffect(effect, target, undefined, applier);
  return true;
}

// The selected or dropped targets get the immunity (the result card's
// button, for every outcome)
function applyMedicineImmunityToSelected(medicine, droppedOn = null) {
  let targets = (api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t);
  if (droppedOn && (isGM || droppedOn?.record?.ownerId === userId)) {
    targets = [droppedOn];
  }
  if (targets.length === 0) {
    api.showNotification("Select the patient's token, then click again.", "yellow", "Notice");
    return;
  }
  const { effect } = getMedicineKind(medicine?.kind);
  targets.forEach((target) => {
    if (applyMedicineImmunity(target, medicine)) {
      api.sendMessage(`${getCreatureName(target)} gains ${effect}.`, undefined, [], [], target);
    }
  });
}

function getMedicineImmunityButton(medicine) {
  const { effect } = getMedicineKind(medicine?.kind);
  const fence = "```";
  return `${fence}Apply_${effect.replace(/\s+/g, "_")}\napplyMedicineImmunityToSelected(${JSON.stringify(medicine)}, typeof record !== "undefined" ? record : null);\n${fence}`;
}

// Battle Medicine: Treat Wounds' check and healing in 1 action
function battleMedicine() {
  treatWounds("battleMedicine");
}

// ---------------------------------------------------------- Persistent damage

// "2d6 fire" -> { formula: "2d6", type: "fire" }
function parsePersistentDamage(value) {
  const text = `${value ?? ""}`.trim();
  const parts = text.split(/\s+/);
  if (parts.length < 2) return { formula: text, type: "untyped" };
  return { formula: parts[0], type: parts.slice(1).join(" ").toLowerCase() };
}

// The average of a formula of dice and numbers ("2d6+3" is 10)
function getFormulaAverage(formula) {
  let total = 0;
  const text = `${formula || ""}`.replace(/\s+/g, "");
  const pattern = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/gi;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match[3]) {
      const sign = match[1] === "-" ? -1 : 1;
      const count = parseInt(match[2] || "1", 10);
      const faces = parseInt(match[3], 10);
      total += sign * count * (faces + 1) / 2;
    } else if (match[5]) {
      total += (match[4] === "-" ? -1 : 1) * parseInt(match[5], 10);
    }
  }
  return total;
}

function getPersistentDamageEffect(token) {
  return (token?.effects || []).find((effect) => effect?.name === "Persistent Damage") || null;
}

// What adding persistent damage of a type does (Player Core pg. 450: of the
// same type, only the higher amount applies): { add, removeIndex, kept }.
// add false: an equal or higher instance of that type is already there.
function getPersistentStackChange(target, persistentValue) {
  // Several types in one ("1d6 fire, 1d4 bleed") are added as they are
  if (`${persistentValue ?? ""}`.includes(",")) return { add: true, removeIndex: null, kept: null };
  const { formula, type } = parsePersistentDamage(persistentValue);
  const effect = getPersistentDamageEffect(target);
  const instances = getPersistentDamageInstances(target, effect);
  const incoming = getFormulaAverage(formula);
  let best = null;
  instances.forEach((instance, index) => {
    const value = instance && typeof instance === "object" ? instance.value : instance;
    const parsed = parsePersistentDamage(value);
    if (parsed.type !== type) return;
    const average = getFormulaAverage(parsed.formula);
    if (!best || average > best.average) best = { index, average, value };
  });
  if (!best) return { add: true, removeIndex: null, kept: null };
  if (best.average >= incoming) return { add: false, removeIndex: null, kept: best.value };
  return { add: true, removeIndex: best.index, kept: null };
}

// The setting "Persistent Damage Recovery": the flat check as a button
// (default) or rolled automatically
function isPersistentRecoveryAuto() {
  const value = typeof api?.getSetting === "function" ? api.getSetting("persistentRecoveryRoll") : null;
  return value === "auto";
}

// Particularly appropriate help (Player Core pg. 450) lowers the DC to 10:
// 5 less than the creature's own DC
function getPersistentAssistDC(dc) {
  const recoveryDC = parseInt(dc, 10) || PERSISTENT_RECOVERY_DC;
  return Math.max(1, recoveryDC - 5);
}

function getPersistentRecoveryMetadata(dc, partIndex, tokenId, assisted = false) {
  return {
    dc,
    rollName: assisted ? "Assisted Recovery Flat Check" : "Persistent Damage Flat Check",
    tooltip: assisted
      ? "Flat Check to Recover from Persistent Damage, with particularly appropriate help"
      : "Flat Check to Recover from Persistent Damage",
    isPersistent: true,
    persistentPartIndex: partIndex,
    ...(tokenId ? { tokenId } : {}),
  };
}

function getPersistentAssistButton(dc, partIndex, tokenId) {
  const assistDC = getPersistentAssistDC(dc);
  const fence = "```";
  return `${fence}Assisted_Recovery_(DC_${assistDC})\napi.promptRoll("Assisted Recovery", "1d20", [], ${JSON.stringify(getPersistentRecoveryMetadata(assistDC, partIndex, tokenId, true))}, "flatCheck");\n${fence}`;
}

// The recovery check after persistent damage: rolled now when the setting
// says so, else the Roll_Recovery button. Either way, the button for help.
function getPersistentRecoveryOutput(dc, partIndex, tokenId) {
  const recoveryDC = parseInt(dc, 10) || PERSISTENT_RECOVERY_DC;
  const assist = getPersistentAssistButton(recoveryDC, partIndex, tokenId);
  if (isPersistentRecoveryAuto()) {
    api.roll("1d20", getPersistentRecoveryMetadata(recoveryDC, partIndex, tokenId), "flatCheck");
    return assist;
  }
  return `${getPersistentRecoveryButton(recoveryDC, partIndex)}\n${assist}`;
}

// The token a persistent damage flat check is for: the chat card's token, or
// the one the roll names (an automatic roll)
function getPersistentRecoveryToken(tokenId) {
  const token = api.getToken();
  if (!tokenId || token?._id === tokenId) return token;
  const other = (api.getOtherTokens() || [])
    .map((t) => t?.token || t)
    .find((t) => t?._id === tokenId);
  return other || token;
}

// The indexes of a creature's persistent bleed instances, highest first (so
// each removal leaves the others' indexes alone)
function getPersistentBleedIndexes(token) {
  const effect = getPersistentDamageEffect(token);
  return getPersistentDamageInstances(token, effect)
    .map((instance, index) => {
      const value = instance && typeof instance === "object" ? instance.value : instance;
      return parsePersistentDamage(value).type === "bleed" ? index : -1;
    })
    .filter((index) => index >= 0)
    .sort((a, b) => b - a);
}

// Persistent bleed ends when the creature is healed to full Hit Points. One
// instance after the other, then the callback.
function endPersistentBleed(token, callback) {
  const effect = getPersistentDamageEffect(token);
  const indexes = getPersistentBleedIndexes(token);
  if (!effect || indexes.length === 0) {
    if (callback) callback();
    return false;
  }
  const next = () => {
    const index = indexes.shift();
    if (index === undefined) {
      if (callback) callback();
      return;
    }
    api.removeEffectById(effect._id, token, next, { instanceIndex: index });
  };
  next();
  return true;
}

// ---------------------------------------------------------------- Rest

const REST_OPTIONS = [
  { label: "No shelter or comfort (half healing)", value: "noShelter" },
  { label: "Slept in armor (wake fatigued)", value: "armor" },
];

// Whether the character's worn armor lets them sleep in it (comfort trait)
function hasComfortArmor(creature) {
  return (creature?.data?.inventory || []).some(
    (item) =>
      item?.data?.type === "armor" &&
      item?.data?.carried === "equipped" &&
      (item?.data?.traits || []).some((trait) => `${trait}`.toLowerCase() === "comfort"),
  );
}

// A rest's Hit Points: the 8-hour amount, halved (minimum 1) without shelter,
// or for long-term rest double per full day
function getRestHealingAmount(base, options = {}) {
  const amount = Math.max(0, parseInt(base, 10) || 0);
  const days = Math.max(0, parseInt(options.days, 10) || 0);
  if (days > 0) return amount * 2 * days;
  if (options.noShelter) return amount > 0 ? Math.max(1, Math.floor(amount / 2)) : 0;
  return amount;
}

// Whether sleeping in armor wakes the character fatigued
function isRestFatiguing(creature, options = {}) {
  return !!options.armor && !hasComfortArmor(creature);
}

// The rest prompt: options, then long-term rest days, then the rest
function showRestOptions(creature, callback) {
  api.showPrompt(
    "Rest",
    "How did the character rest? Leave both unticked for a normal night's rest.",
    "Select...",
    REST_OPTIONS,
    null,
    (choice) => {
      const chosen = Array.isArray(choice) ? choice : choice ? [choice] : [];
      api.showPrompt(
        "Long-Term Rest",
        "Full days of long-term rest (each heals double). Pick 8 hours for a normal rest.",
        "Select...",
        [
          { label: "8 hours", value: "0" },
          ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ label: `${n} day${n > 1 ? "s" : ""}`, value: `${n}` })),
        ],
        null,
        (days) => {
          const value = parseInt(Array.isArray(days) ? days[0] : days, 10) || 0;
          callback({
            noShelter: chosen.includes("noShelter"),
            armor: chosen.includes("armor"),
            days: value,
          });
        },
        "Rest",
        "Cancel",
        1,
      );
    },
    "Next",
    "Cancel",
    REST_OPTIONS.length,
  );
}

// The chat line's notes for the options chosen
function getRestOptionNotes(creature, options = {}) {
  const notes = [];
  if (options.days > 0) {
    notes.push(`Long-term rest, ${options.days} day${options.days > 1 ? "s" : ""}: advance the calendar.`);
  } else {
    notes.push("Advance the calendar 8 hours (more with watches).");
  }
  if (options.noShelter && !(options.days > 0)) notes.push("Rested without shelter or comfort: half healing.");
  if (options.armor) {
    notes.push(
      hasComfortArmor(creature)
        ? "Slept in comfort armor: no fatigue."
        : "Slept in armor: wakes up fatigued.",
    );
  }
  return notes;
}

// Watches and rest (GM Core pg. 43): with n on rotating watch, the night is
// 8 hours x n / (n - 1), each watch 8 hours / (n - 1)
function getWatchSchedule(count) {
  const n = parseInt(count, 10) || 0;
  if (n < 2) return null;
  const watchMinutes = Math.round((8 * 60) / (n - 1));
  return { totalMinutes: watchMinutes * n, watchMinutes };
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} hour${h === 1 ? "" : "s"}${m ? `, ${m} minutes` : ""}`;
}

// The watch order for the party: each one's watch, in order, and a button to
// pick who's on watch when something happens
function getWatchOrderMessage(party) {
  const members = (party || []).filter(Boolean);
  const schedule = getWatchSchedule(members.length);
  if (!schedule) {
    return "A watch needs at least 2 party members. Open the Party Sheet from the View menu and drag the characters onto it.";
  }
  const lines = members.map((member, index) => {
    const start = formatMinutes(index * schedule.watchMinutes);
    const perception = parseInt(member?.data?.perceptionMod ?? member?.data?.perception ?? "0", 10) || 0;
    return `${index + 1}. ${getCreatureName(member)} (Perception ${perception >= 0 ? "+" : ""}${perception}), from ${start}`;
  });
  const names = JSON.stringify(members.map((member) => getCreatureName(member)));
  const fence = "```";
  return `**Watches and Rest**: ${members.length} on watch, ${formatMinutes(schedule.totalMinutes)} in all, each watch ${formatMinutes(schedule.watchMinutes)}.\n${lines.join("\n")}\n\n[gm]Sleepers roll Perception for initiative at -4 (unconscious).[/gm]\n${fence}Who_Is_on_Watch\nconst names = ${names}; api.sendMessage("On watch: " + names[Math.floor(Math.random() * names.length)]);\n${fence}`;
}

// The GM's watch order for the party (a chat macro)
function showWatchOrder() {
  api.getParty((party) => {
    api.sendMessage(getWatchOrderMessage(party));
  });
}

// ------------------------------------------ Fast healing, regeneration, ferocity

// A monster's fast healing and regeneration, from its Hit Points details
// ("regeneration 20 (deactivated by electricity or fire)") or, failing that,
// its abilities' names: { fastHealing, regeneration, deactivatedBy }
function getSelfHealing(creature) {
  const result = { fastHealing: 0, regeneration: 0, deactivatedBy: [] };
  if (creature?.recordType === "characters") return result;
  const sources = [
    `${creature?.data?.hpDetails || ""}`,
    ...(creature?.data?.actions || []).map((action) => `${action?.name || ""}`),
  ];
  for (const text of sources) {
    const fast = text.match(/fast healing\s+(\d+)/i);
    if (fast && !result.fastHealing) result.fastHealing = parseInt(fast[1], 10);
    const regen = text.match(/regeneration\s+(\d+)(?:\s*\(\s*deactivated by\s+([^)]*)\))?/i);
    if (regen && !result.regeneration) {
      result.regeneration = parseInt(regen[1], 10);
      result.deactivatedBy = `${regen[2] || ""}`
        .split(/,|\bor\b|\band\b/i)
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return result;
}

// Regeneration is off from damage of a listed type until the end of the
// creature's next turn: data.regenerationOff is "pending" until that turn
// starts, then the round it started in, cleared when it ends
function isRegenerationOff(creature) {
  const off = creature?.data?.regenerationOff;
  return off === "pending" || off === "on" || parseInt(off, 10) > 0;
}

// Whether damage of these types (after immunities, weaknesses and
// resistances) turns the creature's regeneration off
function getRegenerationDeactivation(creature, damageByType) {
  const { regeneration, deactivatedBy } = getSelfHealing(creature);
  if (!regeneration || deactivatedBy.length === 0) return false;
  return Object.entries(damageByType || {}).some(
    ([type, value]) => value > 0 && deactivatedBy.includes(`${type}`.toLowerCase()),
  );
}

// Whether the creature's regeneration keeps it from dying (dying stops at 3)
function hasActiveRegeneration(creature, deactivatedNow = false) {
  return getSelfHealing(creature).regeneration > 0 && !deactivatedNow && !isRegenerationOff(creature);
}

// A monster with active regeneration at 0 Hit Points: dying (up to 3) and
// unconscious, not dead
function getRegenerationZeroHpChanges(target, critical, valuesToSet, oldValues) {
  const dying = getDyingValue(target);
  const next = Math.min(3, getDyingAfterDamage(target, critical));
  oldValues["data.dying"] = dying;
  valuesToSet["data.dying"] = next;
  if (!getTokenCondition(target, "unconscious")) {
    api.addEffects(["Unconscious", "Prone"], target);
  }
  return `${getCreatureName(target)} falls unconscious, kept alive by regeneration (dying ${next}).`;
}

// The Hit Points a creature gets back at the start of its turn, and from what
function getTurnStartSelfHealing(creature) {
  if (isTokenDead(creature)) return null;
  const { fastHealing, regeneration } = getSelfHealing(creature);
  const amount =
    (fastHealing || 0) + (regeneration && !isRegenerationOff(creature) ? regeneration : 0);
  if (!(amount > 0)) return null;
  const names = [];
  if (fastHealing) names.push(`fast healing ${fastHealing}`);
  if (regeneration && !isRegenerationOff(creature)) names.push(`regeneration ${regeneration}`);
  return { amount, source: names.join(" and ") };
}

// Turn start: regeneration switched off before this turn stays off through
// it (the round it started in); fast healing and regeneration heal. Once per
// round, as Next after Previous starts the same turn again.
function runTurnStartSelfHealing(token, round) {
  const { fastHealing, regeneration } = getSelfHealing(token);
  if (!fastHealing && !regeneration) return;
  if (round !== null && round !== undefined && token.data?.selfHealRound === round) return;
  const extraValues = {};
  if (round !== null && round !== undefined) extraValues["data.selfHealRound"] = round;
  if (token.data?.regenerationOff === "pending") {
    extraValues["data.regenerationOff"] = round ?? "on";
  }
  const healing = getTurnStartSelfHealing(token);
  const curhp = parseInt(token.data?.curhp || "0", 10) || 0;
  const maxHp = parseInt(token.data?.hitpoints || "0", 10) || 0;
  if (healing && curhp < maxHp) {
    applyHealingToToken(token, healing.amount, { source: healing.source, extraValues });
  } else if (Object.keys(extraValues).length > 0) {
    api.setValuesOnTokenById(token._id, token.recordType, extraValues);
  }
  if (regeneration && isRegenerationOff(token)) {
    api.sendMessage(`${getCreatureName(token)}'s regeneration is off this turn.`, undefined, [], [], token);
  }
}

// Turn end: regeneration switched off before this turn comes back on
function getTurnEndRegenerationValues(token) {
  const off = token?.data?.regenerationOff;
  if (!isRegenerationOff(token) || off === "pending") return null;
  return { "data.regenerationOff": "" };
}

// A monster's Ferocity reaction (Monster Core): it can use it until wounded 3
function hasMonsterFerocity(creature) {
  if (creature?.recordType === "characters") return false;
  return (creature?.data?.actions || []).some((action) =>
    /^ferocity\b/i.test(`${action?.name || ""}`.trim()),
  );
}

function canUseMonsterFerocity(creature) {
  return hasMonsterFerocity(creature) && getWoundedValue(creature) < 3;
}

// Ferocity: the monster stays at 1 HP and its wounded value goes up by 1.
// Undoes what the damage did at 0 HP: `before` holds its dying value and
// whether the damage added Dead, or Unconscious and Prone.
function useMonsterFerocity(token, before = {}) {
  if (!token?.data) return;
  if (!canChangeToken(token)) {
    api.showNotification("Only the GM can use a monster's Ferocity.", "yellow", "Notice");
    return;
  }
  const name = getCreatureName(token);
  if (!canUseMonsterFerocity(token)) {
    api.showNotification(`${name} is wounded 3 and can't use Ferocity.`, "yellow", "Notice");
    return;
  }
  const wounded = getWoundedValue(token) + 1;
  api.setValuesOnTokenById(token._id, token.recordType, {
    "data.curhp": 1,
    "data.dying": parseInt(before.dying || "0", 10) || 0,
    "data.wounded": wounded,
  });
  const remove = [
    ...(before.addedDead ? ["dead"] : []),
    ...(before.addedUnconscious ? ["unconscious", "prone"] : []),
  ]
    .map((condition) => getTokenCondition(token, condition)?.effect?._id)
    .filter(Boolean);
  const removeNext = () => {
    const id = remove.shift();
    if (id) api.removeEffectById(id, token, removeNext);
  };
  removeNext();
  api.sendMessage(`**${name} uses Ferocity**: stays at 1 HP, wounded ${wounded}.`, undefined, undefined, undefined, token);
}

function getMonsterFerocityButton(target, before) {
  return getChatButton("Ferocity", target, `useMonsterFerocity(token, ${JSON.stringify(before)})`);
}
