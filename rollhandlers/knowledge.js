// Recall Knowledge and Identify Magic (roadmap H22): the DCs worked out for
// the GM, who still decides what applies.
//   - Recall Knowledge on a targeted creature (the "Roll as" menu or an action
//     card): rolled against its level-based DC adjusted for rarity (GM Core
//     pg. 54), with a [gm] note of the skills its traits call for (Creature
//     Identification), the Lore DCs, the DCs for later attempts, its lowest
//     save and its weaknesses
//   - Identify Magic and Identify Alchemy: the character picks an unidentified
//     item they carry; the DC is its level-based DC adjusted for rarity, very
//     hard with a skill outside its tradition, incredibly hard if it's cursed
//     (GM Core). The result has a GM button that identifies it.
// These are secret checks: with the Secret Checks setting on, the roll and
// its card are GM-only (check-tools.js); otherwise the dice show, and only
// the DCs and notes are hidden.

// GM Core's Creature Identification table: the skills for each trait
const CREATURE_IDENTIFICATION_SKILLS = {
  aberration: ["occultism"],
  animal: ["nature"],
  astral: ["occultism"],
  beast: ["arcana", "nature"],
  celestial: ["religion"],
  construct: ["arcana", "crafting"],
  dragon: ["arcana"],
  dream: ["occultism"],
  elemental: ["arcana", "nature"],
  ethereal: ["occultism"],
  fey: ["nature"],
  fiend: ["religion"],
  fungus: ["nature"],
  humanoid: ["society"],
  monitor: ["religion"],
  ooze: ["occultism"],
  plant: ["nature"],
  shade: ["religion"],
  spirit: ["occultism"],
  time: ["occultism"],
  undead: ["religion"],
};

// A creature's or item's traits, lowercased (strings or { name } objects).
// The traditions' skills for Identify Magic are TRADITION_SKILLS
// (item-spells.js).
function getKnowledgeTraits(subject) {
  return getTraitNameList([...(subject?.data?.traits || []), ...(subject?.data?.traitsList || [])]);
}

// GM Core's DC adjustments (Table 10-6), easiest to hardest, and the step
// each rarity starts on
const DC_ADJUSTMENT_STEPS = [-10, -5, -2, 0, 2, 5, 10];
const RARITY_ADJUSTMENTS = { common: 0, uncommon: 2, rare: 5, unique: 10 };

function getRarityAdjustment(subject) {
  return RARITY_ADJUSTMENTS[getItemRarity(subject) || "common"];
}

// The level-based DC with no adjustment; Proficiency without Level takes the
// level off, as for crafting
function getKnowledgeBaseDC(subject, variants = getVariantRules()) {
  const level = parseInt(subject?.data?.level || 0, 10) || 0;
  const dc = getDCForLevel(level);
  return variants.proficiencyWithoutLevel ? dc - level : dc;
}

// The level-based DC with an adjustment: the rarity's, unless one is given
function getKnowledgeDC(subject, adjustment = getRarityAdjustment(subject)) {
  return getKnowledgeBaseDC(subject) + adjustment;
}

// Later attempts: each a step up the scale from the first attempt's
// adjustment, ending at incredibly hard (GM Core pg. 54, as Foundry's
// createDifficultyScale)
function getLaterAttemptDCs(baseDC, adjustment) {
  return DC_ADJUSTMENT_STEPS.filter((step) => step > adjustment).map((step) => baseDC + step);
}

// ---------------------------------------------------------------- Recall Knowledge

// The skills a creature's traits call for, with the trait that calls for each
function getRecallKnowledgeSkills(creature) {
  const skills = {};
  getKnowledgeTraits(creature).forEach((trait) => {
    (CREATURE_IDENTIFICATION_SKILLS[trait] || []).forEach((skill) => {
      skills[skill] = skills[skill] || trait;
    });
  });
  return skills;
}

// The GM's note on a Recall Knowledge check: the DC, the skills that fit,
// Lore, later attempts, and a short cheat sheet
function getRecallKnowledgeNote(creature, skill, dc) {
  const name = getTokenDisplayName(creature);
  const rarity = getItemRarity(creature);
  const skills = getRecallKnowledgeSkills(creature);
  const fits = Object.entries(skills).map(([s, trait]) => `${capitalize(s)} (${trait})`);
  const later = getLaterAttemptDCs(getKnowledgeBaseDC(creature), getRarityAdjustment(creature));
  const lines = [
    `**Recall Knowledge, ${name}** (level ${parseInt(creature?.data?.level || 0, 10) || 0}${rarity ? `, ${rarity}` : ""}): DC ${dc}.`,
    fits.length
      ? `Skills: ${fits.join(", ")}.${skills[skill] ? "" : ` ${capitalize(skill)} isn't one: a stretch is harder (DC ${dc + 2} or ${dc + 5}).`}`
      : "No creature trait names a skill: your call.",
    `Lore: DC ${dc - 2} (specific) or ${dc - 5} (very specific). ${
      later.length
        ? `Later attempts: DC ${later.join(", ")}; none after a failure or the incredibly hard one.`
        : "No later attempts: it's already incredibly hard."
    }`,
  ];
  const cheatSheet = getRecallKnowledgeCheatSheet(creature);
  if (cheatSheet) lines.push(cheatSheet);
  return lines.join("\n");
}

// What a success might tell: the lowest save and the weaknesses
function getRecallKnowledgeCheatSheet(creature) {
  const saves = [
    ["Fortitude", creature?.data?.fortitudeMod],
    ["Reflex", creature?.data?.reflexMod],
    ["Will", creature?.data?.willMod],
  ]
    .map(([save, mod]) => [save, parseInt(mod, 10)])
    .filter(([, mod]) => Number.isFinite(mod));
  const lowest = saves.length ? saves.reduce((low, save) => (save[1] < low[1] ? save : low)) : null;
  const weaknesses = (creature?.data?.weaknesses || [])
    .filter((w) => w?.data?.type)
    .map((w) => `${w.data.type} ${parseInt(w.data.value, 10) || 0}`);
  const parts = [];
  if (lowest) parts.push(`lowest save ${lowest[0]} ${lowest[1] >= 0 ? "+" : ""}${lowest[1]}`);
  if (weaknesses.length) parts.push(`weaknesses ${weaknesses.join(", ")}`);
  return parts.length ? `Cheat sheet: ${parts.join("; ")}.` : "";
}

// Recall Knowledge against a targeted NPC: the DC and the GM's note for the
// roll (performSkillAction), or null without one
function getRecallKnowledgeCheck(target, skill) {
  if (!target || target.recordType !== "npcs") return null;
  const dc = getKnowledgeDC(target);
  return { dc, gmNote: getRecallKnowledgeNote(target, skill, dc) };
}

// ---------------------------------------------------------------- Identify Magic

// The skills that identify an item without a harder DC: its traditions', any
// of the four for magic without one, Crafting for alchemy
function getIdentifySkills(item) {
  const traits = getKnowledgeTraits(item);
  if (traits.includes("alchemical")) return ["crafting"];
  const traditions = Object.keys(TRADITION_SKILLS).filter((t) => traits.includes(t));
  return traditions.length ? traditions.map((t) => TRADITION_SKILLS[t]) : Object.values(TRADITION_SKILLS);
}

// The DC to identify an item with a skill: level-based with its rarity, or
// incredibly hard in place of the rarity if it's cursed (GM Core pg. 54, as
// Foundry's getDcRarity), then very hard (+5) with a skill outside its
// tradition. Returns { dc, notes } for the GM.
function getIdentifyDC(item, skill) {
  const cursed = getKnowledgeTraits(item).includes("cursed");
  let dc = getKnowledgeDC(item, cursed ? RARITY_ADJUSTMENTS.unique : getRarityAdjustment(item));
  const notes = [];
  if (cursed) {
    notes.push("cursed: incredibly hard in place of its rarity; only a critical success reveals the curse");
  }
  if (!getIdentifySkills(item).includes(`${skill}`.toLowerCase())) {
    dc += 5;
    notes.push(`${capitalize(skill)} is outside its tradition (very hard, +5)`);
  }
  return { dc, notes };
}

// The character's unidentified items for the action, as they see them:
// alchemical ones for Identify Alchemy, the others for Identify Magic
function getUnidentifiedItems(record, actionName = "Identify Magic") {
  const alchemy = actionName === "Identify Alchemy";
  return (record?.data?.inventory || [])
    .filter((item) => item?.identified === false)
    .filter((item) => getKnowledgeTraits(item).includes("alchemical") === alchemy)
    .map((item) => ({ id: item._id, label: item.unidentifiedName || "Unidentified item", item }));
}

// Identify Magic or Identify Alchemy from the sheet: pick the item, then roll
// against its DC. "Something else" rolls without one (a location or effect).
function promptIdentifyItem(record, skill, actionName, roll) {
  const items = getUnidentifiedItems(record, actionName);
  const options = [...items.map(({ id, label }) => ({ label, value: id })), { label: "Something else (no DC)", value: "none" }];
  api.showPrompt(
    actionName,
    "What are you identifying?",
    "Select...",
    options,
    null,
    (choice) => {
      const id = Array.isArray(choice) ? choice[0] : choice;
      if (!id) return;
      const picked = items.find((entry) => entry.id === id);
      if (!picked) {
        roll(null, {});
        return;
      }
      const { dc, notes } = getIdentifyDC(picked.item, skill);
      const name = picked.item.name || picked.label;
      const gmNote = `**${actionName}, ${name}** (level ${parseInt(picked.item.data?.level || 0, 10) || 0}): DC ${dc}${notes.length ? `; ${notes.join("; ")}` : ""}. On a critical failure they misidentify it as something of your choice.`;
      const recordId = record.recordId || record._id;
      const recordType = record.recordType || "characters";
      roll(dc, {
        gmNote,
        gmMacro: `\`\`\`Identify_Item\nif (isGM) identifyInventoryItem(${JSON.stringify(recordType)}, ${JSON.stringify(recordId)}, ${JSON.stringify(id)});\n\`\`\``,
      });
    },
    "Roll",
    "Cancel",
    1,
  );
}

// The GM's button: the item shows as identified (one write), and the GM gets
// a notification saying so
function identifyInventoryItem(recordType, recordId, itemId) {
  api.getRecord(recordType, recordId, (record) => {
    const index = (record?.data?.inventory || []).findIndex((item) => item?._id === itemId);
    const owner = record?.name || "The character";
    if (index < 0) {
      api.showNotification(`${owner} no longer has that item.`, "yellow", "Identify Item");
      return;
    }
    const item = record.data.inventory[index];
    if (item.identified !== false) {
      api.showNotification(`${item.name} is already identified.`, "yellow", "Identify Item");
      return;
    }
    api.setValuesOnRecord(record, { [`data.inventory.${index}.identified`]: true });
    api.showNotification(`${owner}'s ${item.unidentifiedName || "item"} is identified: ${item.name}.`, "green", "Identify Item");
  });
}
