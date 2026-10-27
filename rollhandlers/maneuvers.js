// Maneuvers and other skill actions against a target: what each degree of
// success does, as Foundry PF2e's action macros note it, with buttons that
// apply the conditions, and the item bonus a weapon with the action's trait
// gives. performSkillAction (common.js) rolls the action against the
// target's DC; skill.js shows these lines with the result. Loaded as one of
// the ruleset's scripts (ruleset.config.json, otherSettings.scripts), so it
// shares common.js's scope at runtime.

// By action, by degree (2 critical success ... -1 critical failure): the text,
// and the conditions it gives the target or the creature acting
const MANEUVER_OUTCOMES = {
  grapple: {
    2: {
      text: "Your target is restrained until the end of your next turn unless you move or your target Escapes.",
      target: [["Restrained", 1]],
    },
    1: {
      text: "Your target is grabbed until the end of your next turn unless you move or your target Escapes.",
      target: [["Grabbed", 1]],
    },
    0: {
      text: "You fail to grab your target. If you already had the target grabbed or restrained using a Grapple, those conditions on the target end.",
    },
    "-1": {
      text: "If you already had the target grabbed or restrained, it breaks free. Your target can either grab you, as if it succeeded at using the Grapple action against you, or force you to fall and land prone.",
    },
  },
  trip: {
    2: {
      text: "The target falls and lands prone and takes 1d6 bludgeoning damage.",
      target: [["Prone", 1]],
      damage: "1d6 bludgeoning",
    },
    1: { text: "The target falls and lands prone.", target: [["Prone", 1]] },
    "-1": { text: "You lose your balance and fall and land prone.", self: [["Prone", 1]] },
  },
  shove: {
    2: {
      text: "You push your target up to 10 feet away from you. You can Stride after it, but you must move the same distance and in the same direction.",
    },
    1: {
      text: "You push your target back 5 feet. You can Stride after it, but you must move the same distance and in the same direction.",
    },
    "-1": { text: "You lose your balance, fall, and land prone.", self: [["Prone", 1]] },
  },
  disarm: {
    2: { text: "You knock the item out of the target's grasp. It falls to the ground in the target's space." },
    1: {
      text: "You weaken your target's grasp on the item. Further attempts to Disarm the target of that item gain a +2 circumstance bonus, and the target takes a -2 circumstance penalty to attacks with the item or other checks requiring a firm grasp on the item. The creature can end the effect by Interacting to change its grip on the item; otherwise, it lasts as long as the creature holds the item.",
    },
    "-1": {
      text: "You lose your balance and become off-guard until the start of your next turn.",
      self: [["Off-Guard", 1]],
    },
  },
  reposition: {
    2: {
      text: "You move the creature up to 10 feet. It must remain within your reach during this movement, and you can't move it into or through obstacles.",
    },
    1: {
      text: "You move the target up to 5 feet. It must remain within your reach during this movement, and you can't move it into or through obstacles.",
    },
    "-1": { text: "The target can move you up to 5 feet as though it successfully Repositioned you." },
  },
  escape: {
    2: {
      text: "You get free and remove the grabbed, immobilized, and restrained conditions imposed by your chosen target. You can then Stride up to 5 feet.",
      free: true,
    },
    1: {
      text: "You get free and remove the grabbed, immobilized, and restrained conditions imposed by your chosen target.",
      free: true,
    },
    "-1": { text: "You don't get free, and you can't attempt to Escape again until your next turn." },
  },
  demoralize: {
    2: { text: "The target becomes frightened 2.", target: [["Frightened", 2]] },
    1: { text: "The target becomes frightened 1.", target: [["Frightened", 1]] },
    any: "Regardless of your result, the target is temporarily immune to your attempts to Demoralize it for 10 minutes.",
  },
  feint: {
    2: {
      text: "You throw your enemy's defenses against you entirely off. The target is off-guard against melee attacks that you attempt against it until the end of your next turn.",
    },
    1: {
      text: "Your foe is fooled, but only momentarily. The target is off-guard against the next melee attack that you attempt against it before the end of your current turn.",
    },
    "-1": {
      text: "Your feint backfires. You are off-guard against melee attacks the target attempts against you until the end of your next turn.",
    },
  },
  "create-a-diversion": {
    1: {
      text: "You become hidden to each creature whose Perception DC is less than or equal to your result. This lasts until the end of your turn or until you do anything except Step or use the Stealth skill to Hide or Sneak. If you Strike a creature, the creature remains off-guard against that attack, and you then become observed.",
    },
    0: {
      text: "You don't divert the attention of any creatures whose Perception DC exceeds your result, and those creatures are aware you were trying to trick them.",
    },
  },
  "tumble-through": {
    1: {
      text: "You move through the enemy's space, treating the squares in its space as difficult terrain (every 5 feet costs 10 feet of movement). If you don't have enough Speed to move all the way through its space, you get the same effect as a failure.",
    },
    0: { text: "Your movement ends, and you trigger reactions as if you had moved out of the square you started in." },
  },
};

// The weapon traits that let a wielded weapon's item bonus to attack rolls
// count for an action (Foundry's action macros: getWeaponPotencyModifier)
const MANEUVER_WEAPON_TRAITS = {
  trip: ["trip", "ranged-trip"],
  grapple: ["grapple"],
  shove: ["shove"],
  disarm: ["disarm"],
};

function getManeuverSlug(actionName) {
  return String(actionName || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Whether an action has outcomes here
function hasManeuverOutcomes(actionName) {
  return !!MANEUVER_OUTCOMES[getManeuverSlug(actionName)];
}

// The item bonus a creature's wielded weapon with the action's trait gives:
// the best weapon's potency rune, as an extra modifier for the roll; ranged
// trip also takes its -2 circumstance penalty. [] for none.
function getManeuverWeaponModifiers(creature, actionName) {
  const traitsFor = MANEUVER_WEAPON_TRAITS[getManeuverSlug(actionName)];
  if (!traitsFor) return [];
  const traitNames = (item) =>
    (Array.isArray(item?.data?.traits) ? item.data.traits : []).map((trait) =>
      String(typeof trait === "string" ? trait : trait?.name || "")
        .toLowerCase()
        .trim(),
    );
  const abp = getAbpBonuses(creature);
  let best = null;
  (creature?.data?.inventory || []).forEach((item) => {
    if (item?.data?.type !== "weapon" || item.data?.carried !== "equipped") return;
    const traits = traitNames(item);
    if (!traitsFor.some((trait) => traits.includes(trait))) return;
    // Automatic Bonus Progression: the attack potency in place of the rune,
    // as performAttackRoll uses it
    const potency = abp ? abp.attack : parseInt(item.data?.runes?.potency || "0", 10) || 0;
    if (!best || potency > best.potency) {
      best = { item, potency, ranged: traits.includes("ranged-trip") && !traits.includes("trip") };
    }
  });
  if (!best) return [];
  const modifiers = [];
  if (best.potency > 0) {
    // ABP's attack potency is a potency bonus, which stacks (untyped here)
    modifiers.push(
      abp
        ? { name: `Attack Potency +${best.potency} (${best.item.name})`, type: "", value: best.potency, active: true }
        : { name: best.item.name, type: "item", value: best.potency, active: true },
    );
  }
  if (best.ranged) {
    modifiers.push({ name: "Ranged Trip", type: "circumstance", value: -2, active: true, isPenalty: true });
  }
  return modifiers;
}

// What performSkillAction passes to the result card for an action with
// outcomes: { action, target and actor ids and names }, or null
function getManeuverMetadata(record, actionName, target) {
  if (!target || !hasManeuverOutcomes(actionName)) return null;
  const actor = (typeof api.getToken === "function" && api.getToken()) || null;
  return {
    action: actionName,
    targetId: target._id,
    targetName: getCreatureName(target),
    actorId: record?._id || actor?._id || "",
    actorName: getCreatureName(record || actor),
  };
}

// The chat button that runs `call` (code using `token`) on one creature's
// token: matched by token id or by the record a token links to
function getManeuverButton(label, creatureId, creatureName, call) {
  const droppedOn = 'typeof record !== "undefined" ? record : null';
  const fence = "```";
  // JSON.stringify, so a name like "Ta'lir" can't break the button's code
  return `${fence}${label}\nwithManeuverToken(${JSON.stringify(String(creatureId))}, ${JSON.stringify(String(creatureName))}, ${droppedOn}, (token) => ${call});\n${fence}`;
}

function withManeuverToken(creatureId, name, droppedOn, action) {
  const matches = (t) => t && (t._id === creatureId || t.recordId === creatureId);
  const selected = (api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t);
  const token = selected.find(matches) || (matches(droppedOn) ? droppedOn : null);
  if (!token) {
    api.showNotification(`Select ${name}'s token, then click again.`, "yellow", "Notice");
    return;
  }
  action(token);
}

// The conditions an Escape frees you from
const ESCAPE_CONDITIONS = ["grabbed", "immobilized", "restrained"];

// The Escape DCs a grabber's abilities list ("Escape DC 28", Foundry's
// [[/act escape dc=28]]): [{ name, dc }] per ability, highest first
function getListedEscapeDCs(grabber) {
  const data = grabber?.data || grabber?.record?.data || {};
  const listed = [];
  [...(data.actions || []), ...(data.attacks || [])].forEach((entry) => {
    const name = String(entry?.name || "").trim();
    const text = `${name} ${entry?.data?.description || ""}`;
    for (const match of text.matchAll(/escape\s+dc\s*=?\s*(\d+)|dc\s*(\d+)\s+(?:to\s+)?escape/gi)) {
      const dc = parseInt(match[1] || match[2], 10);
      if (dc > 0 && !listed.some((l) => l.name === name && l.dc === dc)) listed.push({ name, dc });
    }
  });
  return listed.sort((a, b) => b.dc - a.dc);
}

// What an Escape from a grabber can be against: its Athletics DC (Grab and
// Grapple), then each Escape DC its abilities list (Engulf, Swallow Whole)
function getEscapeChoices(grabber) {
  if (!grabber) return [];
  return [
    { name: "Grab or Grapple", label: "Athletics DC", dcName: "Escape DC (Athletics)", dc: getAthleticsDC(grabber) },
    ...getListedEscapeDCs(grabber).map((l) => ({ ...l, label: "Escape DC", dcName: `Escape DC (${l.name})` })),
  ];
}

// Before an Escape from a grabber that lists Escape DCs, asks which hold it
// is (Grabbed by the pseudopod, or Engulfed) and calls back with that choice
function promptEscapeChoice(grabber, callback) {
  const choices = getEscapeChoices(grabber);
  if (choices.length < 2) {
    callback(choices[0]);
    return;
  }
  api.showPrompt(
    "Escape",
    `What are you escaping from ${getCreatureName(grabber)}?`,
    "Select...",
    choices.map((c, i) => ({ label: `${c.name}: ${c.label} ${c.dc}`, value: String(i) })),
    null,
    (selected) => {
      const choice = choices[parseInt(getPromptSelections(selected)[0], 10)];
      if (choice) callback(choice);
    },
    "Roll",
    "Cancel",
    1,
  );
}

// A creature's Athletics DC: 10 + its Athletics modifier (a character's
// athleticsMod, an NPC's listed skill or else its Strength modifier), with
// its Athletics and Strength modifiers, as rollSkill adds them
function getAthleticsDC(creature) {
  const data = creature?.data || creature?.record?.data || {};
  const isCharacter = creature?.recordType === "characters";
  const listed = (data.skills || []).find((skill) => String(skill?.name || "").toLowerCase() === "athletics");
  const skillMod = isCharacter
    ? parseInt(data.athleticsMod || "0", 10) || 0
    : listed
      ? parseInt(listed.data?.mod || "0", 10) || 0
      : parseInt(data.strMod ?? data.str ?? "0", 10) || 0;
  const mods = mergeModifierLists(
    getEffectsAndModifiersForToken(creature, ["skillBonus", "skillPenalty"], "athletics"),
    getEffectsAndModifiersForToken(creature, ["allBonus", "allPenalty"], "str"),
  );
  let dc = 10 + skillMod + getNpcProficiencyWithoutLevelAdjustment(creature);
  mods.forEach((mod) => {
    if (mod.active === false || mod.situational) return;
    dc += parseInt(mod.value || 0, 10) || 0;
  });
  return dc;
}

// The DC to Escape a grabber (Sean's ruling on #18): the hold chosen in
// promptEscapeChoice, else its Athletics DC
function getEscapeDC(grabber, context = {}) {
  if (!grabber) return null;
  return context.escape?.dc ?? getAthleticsDC(grabber);
}

// Escape: removes the grabbed, immobilized and restrained conditions, one
// stack at a time
function freeFromManeuvers(token) {
  const ids = [];
  (token?.effects || []).forEach((effect) => {
    if (!ESCAPE_CONDITIONS.includes(String(effect?.name || "").toLowerCase())) return;
    const count = (token.effectIds || []).filter((id) => id === effect._id).length || 1;
    for (let i = 0; i < count; i++) ids.push(effect._id);
  });
  const next = () => {
    const id = ids.shift();
    if (id) api.removeEffectById(id, token, next);
  };
  next();
}

// Applies a condition at a value as one gain (frightened 2 from a critical
// Demoralize), after the creature's own conditionGain modifiers
function applyManeuverCondition(token, name, value = 1) {
  addConditionGain(token, name, value, (stacks) =>
    api.addEffects(Array(stacks).fill(name), token),
  );
}

// The result card's lines for a maneuver: the outcome's text, and buttons
// for its conditions and damage
function getManeuverResultLines(maneuver, degree) {
  const outcomes = MANEUVER_OUTCOMES[getManeuverSlug(maneuver?.action)];
  if (!outcomes) return [];
  // An action with no critical entry has its plain one (Foundry notes Tumble
  // Through's and Create a Diversion's failure on a critical failure too)
  const fallback = { 2: "1", "-1": "0" }[String(degree)];
  const outcome = outcomes[String(degree)] || (fallback ? outcomes[fallback] : undefined);
  const lines = [];
  if (outcome?.text) {
    lines.push(`**${maneuver.action}:** ${outcome.text}`);
  }
  if (outcomes.any) {
    lines.push(outcomes.any);
  }
  const conditionButton = (who, name, value) => {
    const id = who === "target" ? maneuver.targetId : maneuver.actorId;
    const creature = who === "target" ? maneuver.targetName : maneuver.actorName;
    const label = `Apply_${name.replace(/[^A-Za-z]/g, "_")}${value > 1 ? `_${value}` : ""}`;
    return getManeuverButton(label, id, creature, `applyManeuverCondition(token, ${JSON.stringify(name)}, ${value})`);
  };
  (outcome?.target || []).forEach(([name, value]) => lines.push(conditionButton("target", name, value)));
  (outcome?.self || []).forEach(([name, value]) => lines.push(conditionButton("self", name, value)));
  if (outcome?.free) {
    lines.push(getManeuverButton("Get_Free", maneuver.actorId, maneuver.actorName, "freeFromManeuvers(token)"));
    lines.push(
      "Get Free removes every grabbed, immobilized, and restrained condition. If another creature or effect still holds you, add its condition back.",
    );
  }
  if (outcome?.damage) {
    lines.push(
      `\`\`\`Roll_Damage\napi.promptRoll(${JSON.stringify(`${maneuver.action} Damage`)}, ${JSON.stringify(outcome.damage)}, [], { rollName: ${JSON.stringify(maneuver.action)} }, "damage");\n\`\`\``,
    );
  }
  return lines;
}
