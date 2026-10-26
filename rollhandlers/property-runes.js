// Property runes: what each one does, as modifiers the engine already reads,
// added to the features getFeaturesFromRunes (PF2e.js) makes for an
// equipped weapon or worn, invested armor.
//   - Weapon runes follow Foundry PF2e's WEAPON_PROPERTY_RUNES (runes.ts):
//     extra damage (persistent, splash, critical-only, against some targets),
//     the resistances their damage ignores, notes on the attack card, keen's
//     critical hit on a 19, and the traits or range some runes change. A
//     weapon rune's modifiers apply only to its own weapon (itemOnly).
//   - Foundry leaves armor runes to the player. Their effects here follow the
//     runes' own text: energy-resistant resistances, fortification's flat
//     check against critical hits, and the item bonuses and lower persistent
//     damage DCs of shadow, slick, sinister knight, quenching and stanching.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// A weapon rune's extra damage on its weapon's Strikes ("1d6 fire",
// "1d10 fire-persistent")
function runeDamage(value, extra = {}) {
  return {
    type: "damageBonus",
    value,
    valueType: "string",
    field: "all",
    active: true,
    itemOnly: true,
    ...extra,
  };
}

// A resistance the weapon's damage ignores
function runeIgnores(damageType) {
  return runeDamage(`ignore ${damageType} resistance`);
}

// A note on the weapon's attack card, for the outcomes it applies to (none:
// every outcome)
function runeNote(text, outcome = undefined, extra = {}) {
  return {
    type: "rollNote",
    value: text,
    valueType: "string",
    field: "attack-roll",
    active: true,
    itemOnly: true,
    ...(outcome ? { outcome } : {}),
    ...extra,
  };
}

// A trait the weapon's Strikes gain (holy, trip, nonlethal)
function runeTrait(trait) {
  return {
    type: "weaponTrait",
    value: trait,
    valueType: "string",
    field: "",
    active: true,
    itemOnly: true,
  };
}

// The weapon's range increment, changed as weaponRange does ("x2")
function runeRange(value) {
  return {
    type: "weaponRange",
    value,
    valueType: "string",
    field: "",
    active: true,
    itemOnly: true,
  };
}

// A change to the degree of success of the weapon's attack rolls (keen)
function runeDegreeAdjustment(adjustment, predicate) {
  return {
    type: "adjustDegreeOfSuccess",
    field: "attack-roll",
    adjustment,
    predicate,
    active: true,
    itemOnly: true,
  };
}

// The wearer's resistance to a damage type
function runeResistance(damageType, value) {
  return {
    type: "resistance",
    modifierType: "none",
    field: damageType,
    valueType: "number",
    value: String(value),
    active: true,
  };
}

// An item bonus to the wearer's checks with a skill
function runeSkillBonus(skill, value, predicate = undefined) {
  return {
    type: "skillBonus",
    modifierType: "item",
    field: skill,
    valueType: "number",
    value: String(value),
    active: true,
    ...(predicate ? { predicate } : {}),
  };
}

// The DC of the flat check to end the wearer's persistent damage of a type
function runeRecoveryDC(damageType, dc) {
  return {
    type: "persistentRecoveryDC",
    modifierType: "none",
    field: damageType,
    valueType: "number",
    value: String(dc),
    active: true,
  };
}

// Weapon runes, keyed as PF2e.js keys them, generated from Foundry's
// WEAPON_PROPERTY_RUNES and its English notes. Not here: grievous, whose
// notes depend on the weapon group's critical specialization.
const WEAPON_RUNE_EFFECTS = {
  anchoring: {
    name: "Anchoring",
    modifiers: [
      runeNote("If you critically hit a target with an anchoring weapon, the weapon casts Dimensional Anchor on the target (DC 27 Will save, counteract modifier +17).", ["criticalSuccess"]),
    ],
  },
  ashen: {
    name: "Ashen",
    modifiers: [
      runeDamage("1d4 fire-persistent"),
      runeNote("This ash clouds the senses, causing the creature to become Confused for 1 round unless it succeeds at a DC 25 Will save.", ["success", "criticalSuccess"]),
    ],
  },
  astral: {
    name: "Astral",
    modifiers: [
      runeDamage("1d6 spirit"),
    ],
  },
  bloodthirsty: {
    name: "Bloodthirsty",
    modifiers: [
      runeNote("When you critically hit a target that's taking Persistent Bleed Damage, your target becomes Drained 1.", ["criticalSuccess"]),
    ],
  },
  brilliant: {
    name: "Brilliant",
    modifiers: [
      runeDamage("1d4 fire"),
      runeDamage("1d4 spirit", { predicate: "[\"target:trait:fiend\"]" }),
      runeDamage("1d4 vitality", { predicate: "[\"target:negative-healing\"]" }),
      runeNote("On a critical hit, the target must succeed at a DC 29 Fortitude save or be Blinded for 1 round.", ["criticalSuccess"]),
    ],
  },
  corrosive: {
    name: "Corrosive",
    modifiers: [
      runeDamage("1d6 acid"),
      runeNote("On a critical hit, the target's armor (if any) takes 3d6 acid damage (before applying Hardness); if the target has a shield raised, the shield takes this damage instead.", ["criticalSuccess"]),
    ],
  },
  crushing: {
    name: "Crushing",
    modifiers: [
      runeNote("When you critically hit a target with this weapon, your target becomes Clumsy 1 and Enfeebled 1 until the end of your next turn.", ["criticalSuccess"]),
    ],
  },
  decaying: {
    name: "Decaying",
    modifiers: [
      runeDamage("1d4 void"),
      runeDamage("2d4 void-persistent", { critical: true }),
    ],
  },
  deathdrinking: {
    name: "Deathdrinking",
    modifiers: [
      runeDamage("1d6 void", { critical: true, predicate: "[\"target:mode:living\",{\"not\":\"target:negative-healing\"}]" }),
      runeDamage("1d6 vitality", { critical: true, predicate: "[\"target:negative-healing\"]" }),
    ],
  },
  demolishing: {
    name: "Demolishing",
    modifiers: [
      runeDamage("1d6 force-persistent", { predicate: "[\"target:trait:construct\"]" }),
    ],
  },
  vitalizing: {
    name: "Vitalizing",
    modifiers: [
      runeDamage("1d6 vitality-persistent", { predicate: "[\"target:negative-healing\"]" }),
      runeNote("On a critical hit, the undead is also Enfeebled 1 until the end of your next turn.", ["criticalSuccess"], { predicate: "[\"target:negative-healing\"]" }),
    ],
  },
  energyvulnerability: {
    name: "Energy Vulnerability",
    modifiers: [
      runeNote("On a critical hit, the target gains weakness 5 to the chosen energy type until the end of your next turn. This weakness isn't cumulative with any weakness to that energy type the target already has and doesn't affect a creature with immunity or resistance to that energy type.", ["criticalSuccess"]),
    ],
  },
  fearsome: {
    name: "Fearsome",
    modifiers: [
      runeNote("When you critically hit with this weapon, the target becomes Frightened 1.", ["criticalSuccess"]),
    ],
  },
  flaming: {
    name: "Flaming",
    modifiers: [
      runeDamage("1d6 fire"),
      runeDamage("1d10 fire-persistent", { critical: true }),
    ],
  },
  flickering: {
    name: "Flickering",
    modifiers: [
      runeNote("On a critical hit, the weapon flashes bright pulses of color into the creature's eyes, Dazzling the creature for 1 round (this effect has the visual trait).", ["criticalSuccess"]),
    ],
  },
  frost: {
    name: "Frost",
    modifiers: [
      runeDamage("1d6 cold"),
      runeNote("On a critical hit, the target is also Slowed 1 until the end of your next turn unless it succeeds at a DC 24 Fortitude save.", ["criticalSuccess"]),
    ],
  },
  giantkilling: {
    name: "Giant-Killing",
    modifiers: [
      runeDamage("1d6 mental", { predicate: "[\"target:trait:giant\"]" }),
      runeNote("On a critical hit with this weapon, the giant is also Enfeebled 1 until the end of your next turn.", ["criticalSuccess"], { predicate: "[\"target:trait:giant\"]" }),
    ],
  },
  greateranchoring: {
    name: "Greater Anchoring",
    modifiers: [
      runeNote("When you critically hit a target with a weapon with the anchoring rune, the weapon casts 8th-rank Dimensional Anchor on the target (DC 38 Will save, counteract modifier +28), except that if the target critically succeeds at its Will save, instead of having no effect, the dimensional anchor lasts for 1 round.", ["criticalSuccess"]),
      runeNote("When you hit a target with the weapon but don't critically hit, the target is affected by 4th-rank Dimensional Anchor for 1 round without a save (counteract modifier +28).", ["success"]),
    ],
  },
  greaterashen: {
    name: "Greater Ashen",
    modifiers: [
      runeDamage("1d8 fire-persistent"),
      runeNote("This ash clouds the senses, causing the creature to become Confused for 1 round unless it succeeds at a DC 35 Will save. On a critical failure, the effect lasts for 1 minute.", ["success", "criticalSuccess"]),
    ],
  },
  greaterastral: {
    name: "Greater Astral",
    modifiers: [
      runeDamage("1d6 spirit"),
      runeIgnores("spirit"),
    ],
  },
  greaterbrilliant: {
    name: "Greater Brilliant",
    modifiers: [
      runeDamage("1d4 fire"),
      runeDamage("1d4 spirit", { predicate: "[\"target:trait:fiend\"]" }),
      runeDamage("1d4 vitality", { predicate: "[\"target:negative-healing\"]" }),
      runeIgnores("fire"),
      runeIgnores("spirit"),
      runeIgnores("vitality"),
      runeNote("Damage dealt by this weapon ignores the target's resistances to fire, spirit, and vitality. On a critical hit, the target must succeed at a DC 41 Fortitude save or be Blinded for 1 round.", ["criticalSuccess"]),
    ],
  },
  greatercorrosive: {
    name: "Greater Corrosive",
    modifiers: [
      runeDamage("1d6 acid"),
      runeIgnores("acid"),
      runeNote("The acid damage dealt by this weapon ignores the target's acid resistance. On a critical hit, the target's armor (if any) takes 6d6 acid damage (before applying Hardness); if the target has a shield raised, the shield takes this damage instead.", ["criticalSuccess"]),
    ],
  },
  greatercrushing: {
    name: "Greater Crushing",
    modifiers: [
      runeNote("Your critical hits leave the target Clumsy 2 and Enfeebled 2 until the end of your next turn.", ["criticalSuccess"]),
    ],
  },
  greaterdecaying: {
    name: "Greater Decaying",
    modifiers: [
      runeDamage("1d4 void"),
      runeDamage("4d4 void-persistent", { critical: true }),
      runeIgnores("void"),
    ],
  },
  greatervitalizing: {
    name: "Greater Vitalizing",
    modifiers: [
      runeDamage("2d6 vitality-persistent", { predicate: "[\"target:negative-healing\"]" }),
      runeNote("On a critical hit, the undead creature is Enfeebled 1 and Stupefied 1 as long as it has the persistent damage from this rune.", ["criticalSuccess"], { predicate: "[\"target:negative-healing\"]" }),
    ],
  },
  greaterenergyvulnerability: {
    name: "Greater Energy Vulnerability",
    modifiers: [
      runeNote("On a critical hit, the target gains weakness 10 to the chosen energy type until the end of your next turn. This weakness isn't cumulative with any weakness to that energy type the target already has and doesn't affect a creature with immunity or resistance to that energy type.", ["criticalSuccess"]),
    ],
  },
  greaterfearsome: {
    name: "Greater Fearsome",
    modifiers: [
      runeNote("When you critically hit with this weapon, the target becomes Frightened 2.", ["criticalSuccess"]),
    ],
  },
  greaterflaming: {
    name: "Greater Flaming",
    modifiers: [
      runeDamage("1d6 fire"),
      runeDamage("2d10 fire-persistent", { critical: true }),
      runeIgnores("fire"),
    ],
  },
  greaterfrost: {
    name: "Greater Frost",
    modifiers: [
      runeDamage("1d6 cold"),
      runeIgnores("cold"),
      runeNote("Cold damage dealt by this weapon ignores the target's cold resistance. On a critical hit, the target is also Slowed 1 until the end of your next turn unless it succeeds at a DC 34 Fortitude save.", ["criticalSuccess"]),
    ],
  },
  greatergiantkilling: {
    name: "Greater Giant-Killing",
    modifiers: [
      runeDamage("2d6 mental", { predicate: "[\"target:trait:giant\"]" }),
      runeIgnores("mental"),
      runeNote("On a critical hit with this weapon, the giant must attempt a DC 34 Fortitude save with the following effects. Critical Success: The giant is Enfeebled 1 until the end of your next turn. Success: The giant is Enfeebled 2 until the end of your next turn and takes 1d10 mental damage. Failure: The giant is Enfeebled 2 for the next minute and takes 2d10 mental damage. Critical Failure: The giant is Enfeebled 4 for the next minute and takes 4d10 mental damage.", ["criticalSuccess"], { predicate: "[\"target:trait:giant\"]" }),
    ],
  },
  greaterimpactful: {
    name: "Greater Impactful",
    modifiers: [
      runeDamage("1d6 force"),
      runeNote("On a critical hit, you can choose to force the target to succeed at a DC 37 Fortitude save or be pushed 10 feet away from you.", ["criticalSuccess"]),
    ],
  },
  greaterrooting: {
    name: "Greater Rooting",
    modifiers: [
      runeNote("When you critically hit a target with this weapon, roots grow from the target. It's immobilized for 1 round (Escape DC 28) and Clumsy 1 for as long as the immobilization lasts.", ["criticalSuccess"]),
    ],
  },
  greatershock: {
    name: "Greater Shock",
    modifiers: [
      runeDamage("1d6 electricity"),
      runeIgnores("electricity"),
      runeNote("Electricity damage dealt by this weapon ignores the target's electricity resistance (and the other creatures' on a critical hit). On a critical hit, electricity arcs out to deal an equal amount of electricity damage to up to two other creatures of your choice within 10 feet of the target.", ["criticalSuccess"]),
    ],
  },
  greaterthundering: {
    name: "Greater Thundering",
    modifiers: [
      runeDamage("1d6 sonic"),
      runeIgnores("sonic"),
      runeNote("Sonic damage dealt by this weapon ignores the target's sonic resistance. On a critical hit, the target has to succeed at a DC 34 Fortitude save or be Deafened permanently.", ["criticalSuccess"]),
    ],
  },
  holy: {
    name: "Holy",
    modifiers: [
      runeDamage("1d4 spirit", { predicate: "[{\"not\":\"target:trait:unholy\"}]" }),
      runeDamage("2d4 spirit", { predicate: "[\"target:trait:unholy\"]" }),
      runeTrait("holy"),
    ],
  },
  hopeful: {
    name: "Hopeful",
    modifiers: [
      runeNote("On a critical hit with this weapon, you inspire your comrades, pushing them to fight harder and stand for your shared convictions. Allies within 30 feet that share at least one alignment component with you gain a +1 status bonus to attack rolls until the end of your next turn.", ["criticalSuccess"]),
    ],
  },
  hooked: {
    name: "Hooked",
    modifiers: [
      runeTrait("trip"),
    ],
  },
  impactful: {
    name: "Impactful",
    modifiers: [
      runeDamage("1d6 force"),
      runeNote("On a critical hit, you can choose to force the target to succeed at a DC 27 Fortitude save or be pushed 5 feet away from you.", ["criticalSuccess"]),
    ],
  },
  impossible: {
    name: "Impossible",
    modifiers: [
      runeRange("x2"),
    ],
  },
  keen: {
    name: "Keen",
    modifiers: [
      runeDegreeAdjustment({"success": "to-critical-success"}, "[\"check:total:natural:19\",{\"or\":[\"item:damage:type:slashing\",\"item:damage:type:piercing\"]}]"),
    ],
  },
  majorrooting: {
    name: "Major Rooting",
    modifiers: [
      runeNote("When you critically hit a target with this weapon, roots grow from the target. It's immobilized for 1 round (Escape DC 34) and Clumsy 1 for as long as the immobilization lasts.", ["criticalSuccess"]),
    ],
  },
  merciful: {
    name: "Merciful",
    modifiers: [
      runeTrait("nonlethal"),
    ],
  },
  nightmare: {
    name: "Nightmare",
    modifiers: [
      runeDamage("1d6 mental"),
      runeNote("On a critical hit, the target becomes Stupefied 1 by overwhelming visions in their mind of personal horrors that linger. If you critically hit a creature that's already stupefied, it becomes Frightened 2 as well. These critical hit effects have the emotion, fear, and mental traits.", ["criticalSuccess"]),
    ],
  },
  returning: {
    name: "Returning",
    modifiers: [
      runeNote("When you make a thrown Strike with this weapon, it flies back to your hand after the Strike is complete. If your hands are full when the weapon returns, it falls to the ground in your space."),
    ],
  },
  rooting: {
    name: "Rooting",
    modifiers: [
      runeNote("When you critically hit a target with this weapon, roots grow from the target. It's immobilized for 1 round (Escape DC 23) and Clumsy 1 for as long as the immobilization lasts.", ["criticalSuccess"]),
    ],
  },
  serrating: {
    name: "Serrating",
    modifiers: [
      runeDamage("1d4 slashing"),
    ],
  },
  shock: {
    name: "Shock",
    modifiers: [
      runeDamage("1d6 electricity"),
      runeNote("On a critical hit, electricity arcs out to deal an equal amount of electricity damage to up to two other creatures of your choice within 10 feet of the target.", ["criticalSuccess"]),
    ],
  },
  shockwave: {
    name: "Shockwave",
    modifiers: [
      runeDamage("@weaponDiceCount bludgeoning-splash", { predicate: "[\"item:melee\",\"item:damage:type:bludgeoning\"]" }),
      runeNote("The attacker is immune to the splash damage.", ["success", "criticalSuccess"], { predicate: "[\"item:melee\",\"item:damage:type:bludgeoning\"]" }),
    ],
  },
  thundering: {
    name: "Thundering",
    modifiers: [
      runeDamage("1d6 sonic"),
      runeNote("On a critical hit, the target has to succeed at a DC 24 Fortitude save or be Deafened for 1 minute (or 1 hour on a critical failure).", ["criticalSuccess"]),
    ],
  },
  truerooting: {
    name: "True Rooting",
    modifiers: [
      runeNote("When you critically hit a target with this weapon, roots grow from the target. It's immobilized for 1 round (Escape DC 41) and Clumsy 1 for as long as the immobilization lasts.", ["criticalSuccess"]),
    ],
  },
  unholy: {
    name: "Unholy",
    modifiers: [
      runeDamage("1d4 spirit", { predicate: "[{\"not\":\"target:trait:holy\"}]" }),
      runeDamage("2d4 spirit", { predicate: "[\"target:trait:holy\"]" }),
      runeTrait("unholy"),
    ],
  },
  wounding: {
    name: "Wounding",
    modifiers: [
      runeDamage("1d6 bleed-persistent"),
    ],
  },
};

// Slick's item bonus counts for these Acrobatics actions only
const SLICK_PREDICATE = '[{"or":["action:escape","action:squeeze"]}]';

// Armor runes, from their own text
const ARMOR_RUNE_EFFECTS = {
  acidresistant: { name: "Acid Resistant", modifiers: [runeResistance("acid", 5)] },
  coldresistant: { name: "Cold Resistant", modifiers: [runeResistance("cold", 5)] },
  electricityresistant: {
    name: "Electricity Resistant",
    modifiers: [runeResistance("electricity", 5)],
  },
  fireresistant: { name: "Fire Resistant", modifiers: [runeResistance("fire", 5)] },
  greateracidresistant: {
    name: "Greater Acid Resistant",
    modifiers: [runeResistance("acid", 10)],
  },
  greatercoldresistant: {
    name: "Greater Cold Resistant",
    modifiers: [runeResistance("cold", 10)],
  },
  greaterelectricityresistant: {
    name: "Greater Electricity Resistant",
    modifiers: [runeResistance("electricity", 10)],
  },
  greaterfireresistant: {
    name: "Greater Fire Resistant",
    modifiers: [runeResistance("fire", 10)],
  },
  shadow: { name: "Shadow", modifiers: [runeSkillBonus("stealth", 1)] },
  greatershadow: { name: "Greater Shadow", modifiers: [runeSkillBonus("stealth", 2)] },
  majorshadow: { name: "Major Shadow", modifiers: [runeSkillBonus("stealth", 3)] },
  slick: { name: "Slick", modifiers: [runeSkillBonus("acrobatics", 1, SLICK_PREDICATE)] },
  greaterslick: {
    name: "Greater Slick",
    modifiers: [runeSkillBonus("acrobatics", 2, SLICK_PREDICATE)],
  },
  majorslick: {
    name: "Major Slick",
    modifiers: [runeSkillBonus("acrobatics", 3, SLICK_PREDICATE)],
  },
  sinisterknight: { name: "Sinister Knight", modifiers: [runeSkillBonus("deception", 1)] },
  quenching: {
    name: "Quenching",
    modifiers: [runeRecoveryDC("acid", 12), runeRecoveryDC("fire", 12)],
  },
  greaterquenching: {
    name: "Greater Quenching",
    modifiers: [runeRecoveryDC("acid", 10), runeRecoveryDC("fire", 10)],
  },
  majorquenching: {
    name: "Major Quenching",
    modifiers: [runeRecoveryDC("acid", 8), runeRecoveryDC("fire", 8)],
  },
  truequenching: {
    name: "True Quenching",
    modifiers: [runeRecoveryDC("acid", 5), runeRecoveryDC("fire", 5)],
  },
  stanching: { name: "Stanching", modifiers: [runeRecoveryDC("bleed", 12)] },
  greaterstanching: { name: "Greater Stanching", modifiers: [runeRecoveryDC("bleed", 10)] },
  majorstanching: { name: "Major Stanching", modifiers: [runeRecoveryDC("bleed", 8)] },
  truestanching: { name: "True Stanching", modifiers: [runeRecoveryDC("bleed", 5)] },
};

// The flat check DC each fortification rune gives against critical hits
const FORTIFICATION_DCS = {
  fortification: 17,
  greaterfortification: 14,
};

// Legacy runes, by name or Foundry slug, that PF2e.js keys by their
// remaster names
const PROPERTY_RUNE_ALIASES = {
  speed: "quickstrike",
  disrupting: "vitalizing",
  greaterdisrupting: "greatervitalizing",
  spellstoring: "spellreservoir",
  dancing: "animated",
};

// The key PF2e.js and these tables use for a rune on an item: from Foundry's
// slug ("greaterFlaming", as the item sheet stores it), a name ("Ghost
// Touch", as weaponRune adds it) or a legacy name ("speed")
function getPropertyRuneKey(rune) {
  const name = typeof rune === "string" ? rune : rune?.slug || rune?.name || "";
  const key = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return PROPERTY_RUNE_ALIASES[key] || key;
}

// What a property rune does: { name, modifiers }, or null
function getPropertyRuneEffects(rune, isWeapon) {
  const effects = isWeapon ? WEAPON_RUNE_EFFECTS : ARMOR_RUNE_EFFECTS;
  return effects[getPropertyRuneKey(rune)] || null;
}

// Whether a creature's armor is worn and its runes work: equipped, and for
// a character, invested (getEffectsAndModifiersForToken's rule for armor
// with runes)
function isWornRuneArmor(creature, item) {
  if (item?.data?.type !== "armor" || item.data?.carried !== "equipped") {
    return false;
  }
  return creature?.recordType !== "characters" || item.data?.invested === "true";
}

// The fortification a creature's worn armor gives against critical hits:
// { dc, name } for the best one, or null
function getFortification(creature) {
  let best = null;
  (creature?.data?.inventory || []).forEach((item) => {
    if (!isWornRuneArmor(creature, item)) return;
    (item.data?.runes?.property || []).forEach((rune) => {
      const key = getPropertyRuneKey(rune);
      const dc = FORTIFICATION_DCS[key];
      if (dc && (!best || dc < best.dc)) {
        best = { dc, name: getArmorRuneDetails(key).displayName || "Fortification" };
      }
    });
  });
  return best;
}

// The fortification flat check for a critical hit (attack.js): { success,
// text }. On a success, the critical hit becomes a normal hit.
function rollFortificationCheck(fortification) {
  const roll = api.rollInstant("1d20");
  const value = parseInt(roll?.total, 10) || 0;
  const success = value >= fortification.dc;
  return {
    success,
    text: `**${fortification.name}:** DC ${fortification.dc} flat check: ${value}, ${
      success ? "the critical hit becomes a normal hit" : "the critical hit stands"
    }.`,
  };
}
