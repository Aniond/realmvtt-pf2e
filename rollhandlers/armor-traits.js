// Armor check penalty exceptions and armor traits (Player Core pg. 272-275;
// ponderous is from Treasure Vault (Remastered) pg. 220), following Foundry
// PF2e's character prepareSkills, prepareSaves and createPonderousPenalty.
//
//   - Check penalty: Strength- and Dexterity-based skill checks while the
//     wearer's Strength is below the armor's, never on a check with the attack
//     trait (Grapple, Trip, Shove, Disarm, Reposition, Escape)
//   - Flexible: no check penalty on Acrobatics or Athletics
//   - Noisy: the check penalty applies to Stealth even when the Strength is
//     met
//   - Bulwark: on a Reflex save against a damaging effect, +3 instead of the
//     Dexterity modifier. On by itself for a basic save; offered unticked on
//     other Reflex saves
//   - Ponderous: a -1 untyped penalty to initiative, or the check penalty
//     when the Strength isn't met and that's worse
//   - Hindering (the Speed calculation) and comfort (the Rest prompt) were
//     already in place

// The worn armor's traits, lowercase
function getArmorTraitNames(bestArmor) {
  return getTraitNameList(bestArmor?.armor?.traits || []);
}

function hasArmorTrait(bestArmor, trait) {
  return getArmorTraitNames(bestArmor).includes(trait);
}

// Whether the wearer's Strength modifier meets the armor's requirement (no
// requirement counts as met)
function meetsArmorStrength(record, bestArmor) {
  const required = getArmorStrengthRequirement(bestArmor?.armor?.strength);
  if (required === null) return true;
  const strength = parseInt(record?.data?.str ?? 0, 10) || 0;
  return strength >= required;
}

// Whether a check has the attack trait: a basic skill action marked attack
// (SKILL_ACTIONS), or a source that passed the trait
function isAttackTraitCheck(context = {}) {
  const traits = getTraitNameList(context.origin?.data?.traits || []);
  if (traits.includes("attack")) return true;
  const name = String(context.action?.name || "").trim().toLowerCase();
  if (!name) return false;
  return Object.values(SKILL_ACTIONS)
    .flat()
    .some((action) => action.attack && action.name.toLowerCase() === name);
}

// Whether the armor's check penalty applies to this check (Foundry's
// predicates): never with the attack trait; Acrobatics and Athletics unless
// the Strength is met or the armor is flexible; Stealth unless the Strength
// is met and the armor isn't noisy; any other check unless the Strength is
// met. Without a skill in the context, the plain Strength rule.
function isCheckPenaltyApplied(record, bestArmor, context = {}) {
  if (isAttackTraitCheck(context)) return false;
  const met = meetsArmorStrength(record, bestArmor);
  const skill = String(context.statistic || "").toLowerCase();
  if (skill === "acrobatics" || skill === "athletics") {
    return !met && !hasArmorTrait(bestArmor, "flexible");
  }
  if (skill === "stealth" && hasArmorTrait(bestArmor, "noisy")) return true;
  return !met;
}

// Bulwark: +3 instead of the Dexterity modifier on a Reflex save against a
// damaging effect. A basic save is one; any other Reflex save gets it
// unticked. Null without bulwark armor, or when it changes nothing.
function getBulwarkModifier(record, saveType, basic = false) {
  if (saveType !== "reflex" || record?.recordType !== "characters") return null;
  if (!hasArmorTrait(getBestEquippedArmor(record), "bulwark")) return null;
  const dex = parseInt(record.data?.dex ?? 0, 10) || 0;
  const value = 3 - dex;
  if (value === 0) return null;
  return {
    name: "Bulwark (+3 instead of Dex, damaging effects)",
    type: "",
    value,
    isPenalty: value < 0,
    valueType: "number",
    active: !!basic,
  };
}

// Ponderous: a -1 penalty to initiative, untyped (Treasure Vault, Foundry),
// or the check penalty when the Strength isn't met and it's worse. An
// initiativePenalty modifier, so the initiative roll picks it up. Null
// without ponderous armor.
function getPonderousModifier(record, bestArmor) {
  if (record?.recordType !== "characters" || !hasArmorTrait(bestArmor, "ponderous")) return null;
  const checkPenalty = Math.abs(parseInt(bestArmor?.armor?.checkPenalty, 10) || 0);
  const penalty = meetsArmorStrength(record, bestArmor) ? 1 : Math.max(1, checkPenalty);
  return {
    value: -penalty,
    isPenalty: true,
    valueType: "number",
    name: "Ponderous",
    type: "",
    modifierType: "initiativePenalty",
    field: "",
    active: true,
    slug: "ponderous",
  };
}

// ---------------------------------------------------------------- Shields

// Shields (Player Core pg. 276-277; hefty is Treasure Vault (Remastered)
// pg. 219; roadmap H24):
//   - Shield Block: the damage card's Apply Damage to Shield button only for a
//     raised shield that isn't broken (a broken item can't be used for its
//     normal function), on a creature with Shield Block (a character's feat,
//     an NPC's ability)
//   - Hefty N: raising it takes 2 actions unless the Strength modifier is at
//     least N; the Raise a Shield card says so
//   - Destroyed at 0 Hit Points: the damage card says so and the shield is
//     lowered (applyDamage)

// Whether a creature has Shield Block: a character's feat, or an NPC's
// ability of that name
function hasShieldBlock(creature) {
  if (!creature) return false;
  if (creature.recordType === "npcs") {
    return (creature.data?.actions || []).some((action) => `${action?.name || ""}`.trim().toLowerCase() === "shield block");
  }
  return hasFeatNamed(creature, "Shield Block");
}

// Whether a creature can Shield Block now: its shield raised, not broken, and
// the reaction to use
function canShieldBlock(creature) {
  return (
    creature?.data?.shieldRaised === "true" &&
    creature?.data?.shieldBroken !== true &&
    hasShieldBlock(creature)
  );
}

// The number on a shield's hefty trait ("Hefty-2", "Hefty 2"), or null
function getShieldHefty(traits) {
  const hefty = getTraitNameList(traits || []).find((trait) => /^hefty[\s-]*\d+$/.test(trait));
  return hefty ? parseInt(hefty.replace(/\D+/g, ""), 10) : null;
}

// The Raise a Shield card's note for a hefty shield the creature's Strength
// doesn't meet, or ""
function getRaiseShieldNote(creature) {
  const hefty = getShieldHefty(getBestEquippedArmor(creature)?.shield?.traits);
  if (hefty === null) return "";
  const strength = parseInt(creature?.data?.str, 10) || 0;
  if (strength >= hefty) return "";
  return `Hefty ${hefty}: raising it takes 2 actions (Strength ${strength >= 0 ? "+" : ""}${strength}, under +${hefty}).`;
}
