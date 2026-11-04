// Gear rules (roadmap H34-H36): broken items and Repair, talismans and
// spellhearts affixed to gear, and runes (the property rune limit, etching a
// rune item, transferring a rune). Every one assists the GM: notices and
// buttons, and only a broken weapon's Strike is refused, as a broken
// shield's already is.
//
//   - Broken (Player Core pg. 442; GM Core pg. 244, Item Damage): an item
//     with Hit Points is broken at or below its Broken Threshold, half its
//     HP. A broken item grants no bonuses (its bonus modifiers and property
//     runes are left out) but still imposes its penalties, and a broken
//     weapon can't Strike. Broken armor keeps its
//     item bonus to AC (potency too) but loses its resilient rune, and takes
//     a status penalty to AC: -1 light, -2 medium, -3 heavy, 1 less for
//     laminar armor (Treasure Vault pg. 220)
//   - Repair (Player Core pg. 236): the item sheet's Repair button (shown
//     once the item has HP) rolls Crafting against the item's Craft DC. The card restores 5 + 5 per rank
//     (success) or 10 + 10 per rank (critical success), or on a critical
//     failure rolls 2d6 damage to the item, less its Hardness
//   - Talismans and spellhearts (GM Core pg. 263; Secrets of Magic pg. 170):
//     the item sheet's Affix button links one to an item (data.affixedTo, the
//     host's _id). The host's attack and inventory rows show what's affixed,
//     with a Use button. More than one on an item deactivates them all: a
//     notice when affixing and using. A spellheart's modifiers apply only
//     while it's affixed, alone, to an equipped item that isn't broken. A
//     talisman used up stops being affixed
//   - Runes (GM Core pg. 224-225): an item uses as many property runes as
//     its potency value (Automatic Bonus Progression: its attack or defense
//     potency); later ones are dormant, with a notice when they're picked.
//     A rune item's Etch button puts it on a weapon, armor or shield the
//     character has (and takes it out of the inventory). The Crafting tab's
//     Transfer a Rune button starts a 1-day Craft project at the rune's level
//     DC for 10% of its Price, to an item that can take the rune (as Etch);
//     finishing it moves the rune
//
// Item HP and Hardness are the item's otherProperties fields; the modules
// leave them empty for most gear, so these rules apply once the GM fills them
// in. Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// ---------------------------------------------------------------- Broken items

// A Broken Threshold is half the item's maximum HP (GM Core pg. 244)
function getItemBrokenThreshold(item) {
  return Math.floor((parseInt(item?.data?.hp?.max, 10) || 0) / 2);
}

// Broken: at or below the Broken Threshold. Items with no maximum HP filled
// in are never broken (the shield rule, isShieldBroken)
function isItemBroken(item) {
  return isShieldBroken(item?.data?.hp);
}

function isItemDestroyed(item) {
  const max = parseInt(item?.data?.hp?.max, 10) || 0;
  return max > 0 && (parseInt(item?.data?.hp?.value, 10) || 0) <= 0;
}

// The status penalty to AC for broken armor, by category (Player Core
// pg. 442); laminar armor's is 1 less (Treasure Vault pg. 220)
const BROKEN_ARMOR_PENALTY = { light: 1, medium: 2, heavy: 3 };

function getBrokenArmorPenalty(armor) {
  if (!isItemBroken(armor)) return 0;
  const penalty = BROKEN_ARMOR_PENALTY[(armor?.data?.itemCategory || "").toLowerCase()] || 0;
  return itemHasTrait(armor, "laminar") ? Math.max(0, penalty - 1) : penalty;
}

// The worn armor (getBestEquippedArmor's pick)
function getWornArmor(record, bestArmor) {
  const armorId = bestArmor?.armor?.armorId;
  if (!armorId) return null;
  return (record?.data?.inventory || []).find((item) => item._id === armorId) || null;
}

// The broken armor penalty as one of getEffectsAndModifiersForToken's results
function getBrokenArmorModifier(record, bestArmor) {
  const armor = getWornArmor(record, bestArmor);
  const penalty = getBrokenArmorPenalty(armor);
  if (penalty <= 0) return null;
  return {
    value: -penalty,
    isPenalty: true,
    valueType: "number",
    name: `Broken Armor (${armor.name})`,
    type: "status",
    modifierType: "armorClassPenalty",
    field: "all",
    active: true,
    slug: "broken-armor",
  };
}

// Items whose bonuses count: a broken item grants none (Player Core pg. 442)
function getUnbrokenItems(items) {
  return (items || []).filter((item) => !isItemBroken(item));
}

// A penalty modifier: a penalty type, or a negative number
function isPenaltyModifier(modifier) {
  const type = (modifier?.data?.type || "").toLowerCase();
  if (type.includes("penalty") && type !== "ignorerangepenalty") return true;
  const value = parseFloat(modifier?.data?.value);
  return modifier?.data?.valueType === "number" && !isNaN(value) && value < 0;
}

// Items as sources of modifiers: a broken one keeps only its penalties ("A
// broken item still imposes penalties and limitations normally incurred by
// carrying, holding, or wearing it", Player Core pg. 442)
function getItemModifierSources(items) {
  return (items || []).map((item) =>
    isItemBroken(item)
      ? { ...item, data: { ...item.data, modifiers: (item.data?.modifiers || []).filter(isPenaltyModifier) } }
      : item,
  );
}

// The Repair button shows for an inventory item with Hit Points
function isRepairButtonHidden(item, itemDataPath) {
  return !itemDataPath || !((parseInt(item?.data?.hp?.max, 10) || 0) > 0);
}

// The Strike refusal for a broken weapon or shield, or ""
function getBrokenStrikeWarning(weapon) {
  if (!isItemBroken(weapon)) return "";
  return `${weapon.name} is broken: it can't be used to Strike.`;
}

// ---------------------------------------------------------------- Repair

// HP a Repair restores (Player Core pg. 236): 5 + 5 per Crafting rank on a
// success, 10 + 10 per rank on a critical success
function getRepairHp(rank, degree) {
  const ranks = Math.max(0, parseInt(rank, 10) || 0);
  if (degree === 2) return 10 + 10 * ranks;
  if (degree === 1) return 5 + 5 * ranks;
  return 0;
}

// The reason the item can't be Repaired yet, or ""
function getRepairProblem(item) {
  const max = parseInt(item?.data?.hp?.max, 10) || 0;
  if (max <= 0) return `${item?.name || "This item"} has no Hit Points filled in. Fill in its HP and Hardness first.`;
  if (isItemDestroyed(item)) return `${item.name} is destroyed (0 HP): a destroyed item can't be Repaired.`;
  if ((parseInt(item.data?.hp?.value, 10) || 0) >= max) return `${item.name} is already at full Hit Points.`;
  return "";
}

// The item sheet's Repair button, for an item in a character's inventory
function repairInventoryItem(record, itemDataPath) {
  if (!itemDataPath || !itemDataPath.startsWith("data.inventory.")) {
    api.showNotification("Repair an item from a character's inventory.", "yellow", "Repair");
    return;
  }
  const item = api.getValue(itemDataPath);
  const problem = getRepairProblem(item);
  if (problem) {
    api.showNotification(problem, "yellow", "Repair");
    return;
  }
  const repair = {
    recordId: record._id,
    recordType: record.recordType || "characters",
    itemId: item._id,
    itemName: item.name,
    rank: parseInt(record.data?.crafting || 0, 10) || 0,
  };
  rollSkill(record, "crafting", getCraftingDC(item), false, 0, 1, "int", false, false, undefined, {
    action: "Repair",
    traits: ["exploration", "manipulate"],
    dcName: `${item.name}'s Craft DC`,
    rollName: `Repair ${item.name}`,
    repair,
  });
}

// The Repair card's lines: the HP the result restores (a button), or the
// critical failure's damage (a button)
function getRepairLines(repair, degree) {
  if (!repair) return [];
  const lines = ["*Repair takes 10 minutes with a repair toolkit; the GM may set another DC.*"];
  const args = `${JSON.stringify(repair.recordType)}, ${JSON.stringify(repair.recordId)}, ${JSON.stringify(repair.itemId)}`;
  if (degree === 2 || degree === 1) {
    const hp = getRepairHp(repair.rank, degree);
    lines.push(`**Repair:** ${repair.itemName} regains ${hp} HP.`);
    lines.push(`\`\`\`Restore_${hp}_HP\nrestoreItemHp(${args}, ${hp});\n\`\`\``);
  } else if (degree === 0) {
    lines.push(`**Repair:** ${repair.itemName} isn't repaired.`);
  } else if (degree === -1) {
    lines.push(`**Repair:** ${repair.itemName} takes 2d6 damage; its Hardness applies.`);
    lines.push(`\`\`\`Damage_Item_2d6\ndamageRepairedItem(${args});\n\`\`\``);
  }
  return lines;
}

// "now 12/20 HP, broken" for a chat card
function describeItemHp(item) {
  const value = parseInt(item?.data?.hp?.value, 10) || 0;
  const max = parseInt(item?.data?.hp?.max, 10) || 0;
  const state = isItemDestroyed(item) ? ", destroyed" : isItemBroken(item) ? ", broken" : "";
  return `now ${value}/${max} HP${state}`;
}

// An inventory item's HP set to a new value: the write, and the item after
function getItemHpChange(record, itemId, newValue) {
  const inventory = record?.data?.inventory || [];
  const index = inventory.findIndex((item) => item._id === itemId);
  if (index === -1) return null;
  const item = inventory[index];
  const max = parseInt(item.data?.hp?.max, 10) || 0;
  const value = Math.max(0, Math.min(max, newValue));
  return {
    values: { [`data.inventory.${index}.data.hp.value`]: value },
    item: { ...item, data: { ...item.data, hp: { ...(item.data?.hp || {}), value } } },
  };
}

// Writes an item's HP, then recalculates the sheet (a shield's HP, broken
// armor's AC) and posts what happened
function writeItemHp(record, itemId, newValue, describe) {
  const change = getItemHpChange(record, itemId, newValue);
  if (!change) return;
  api.setValuesOnRecord(record, change.values, (updated) => {
    onAddEditFeature(updated || record, undefined, true);
    api.sendMessage(`**${describe}** ${change.item.name} is ${describeItemHp(change.item)}.`);
  });
}

// The Restore button: strikes out its card, so it can't be used twice, then
// adds the HP to the item, read fresh
function restoreItemHp(recordType, recordId, itemId, amount) {
  api.editMessage(null, `~**Repair:** ${amount} HP~ Restored.`);
  api.getRecord(recordType || "characters", recordId, (record) => {
    const item = (record?.data?.inventory || []).find((entry) => entry._id === itemId);
    if (!item) return;
    writeItemHp(record, itemId, (parseInt(item.data?.hp?.value, 10) || 0) + amount, "Repaired:");
  });
}

// The critical failure's button: 2d6 damage, less the item's Hardness
function damageRepairedItem(recordType, recordId, itemId) {
  api.editMessage(null, "~**Repair:** 2d6 damage~ Rolled.");
  api.getRecord(recordType || "characters", recordId, (record) => {
    const item = (record?.data?.inventory || []).find((entry) => entry._id === itemId);
    if (!item) return;
    const rolled = parseInt(api.rollInstant("2d6")?.total, 10) || 0;
    const hardness = parseInt(item.data?.hardness, 10) || 0;
    const damage = Math.max(0, rolled - hardness);
    writeItemHp(
      record,
      itemId,
      (parseInt(item.data?.hp?.value, 10) || 0) - damage,
      `Repair critical failure: 2d6 = ${rolled}, Hardness ${hardness}, ${damage} damage.`,
    );
  });
}

// ---------------------------------------------------------------- Talismans and spellhearts

// One per item: talismans and spellhearts (an item can have one or the
// other, not both)
function isTalismanLike(item) {
  return itemHasTrait(item, "talisman") || itemHasTrait(item, "spellheart");
}

// Items affixed to gear: talismans, spellhearts, and other "affixed to"
// items (ablative plating)
function isAffixableItem(item) {
  return /^(affixed|applied)/.test(item?.data?.usage || "") || isTalismanLike(item);
}

// The item types an affixed item's usage names
function getAffixHostTypes(usage) {
  const text = usage || "";
  const types = [];
  if (/armor|clothing/.test(text)) types.push("armor");
  if (/weapon|firearm|crossbow/.test(text)) types.push("weapon");
  if (/shield/.test(text)) types.push("shield");
  return types.length > 0 ? types : ["armor", "weapon", "shield"];
}

// The character's items it can be affixed to
function getAffixHosts(record, item) {
  const types = getAffixHostTypes(item?.data?.usage);
  return (record?.data?.inventory || []).filter(
    (entry) => entry._id !== item?._id && types.includes(entry.data?.type),
  );
}

// What's affixed to an item
function getAffixedItems(record, hostId) {
  if (!hostId) return [];
  return (record?.data?.inventory || []).filter((item) => item.data?.affixedTo === hostId);
}

function getAffixHost(record, item) {
  const hostId = item?.data?.affixedTo;
  if (!hostId) return null;
  return (record?.data?.inventory || []).find((entry) => entry._id === hostId) || null;
}

// A spellheart works only while affixed, alone, to an equipped item that
// isn't broken
function isAffixedItemActive(record, item) {
  const host = getAffixHost(record, item);
  if (!host || host.data?.carried !== "equipped" || isItemBroken(host)) return false;
  return getAffixedItems(record, host._id).filter(isTalismanLike).length <= 1;
}

// The host rows' Affixed line: the names of what's affixed. Values for the
// rows whose line changes
function getAffixDisplayValues(inventory) {
  const values = {};
  (inventory || []).forEach((host, index) => {
    if (!["weapon", "armor", "shield"].includes(host.data?.type)) return;
    const names = inventory.filter((item) => item.data?.affixedTo === host._id).map((item) => item.name);
    const label = names.join(", ");
    if ((host.data?.affixedLabel || "") !== label) {
      values[`data.inventory.${index}.data.affixedLabel`] = label;
    }
    const hidden = names.length === 0;
    if ((host.fields?.affixedBox?.hidden ?? true) !== hidden) {
      values[`data.inventory.${index}.fields.affixedBox.hidden`] = hidden;
    }
  });
  return values;
}

// The write that affixes an item to a host (hostId null: removes it)
function getAffixValues(record, item, hostId) {
  const inventory = record?.data?.inventory || [];
  const index = inventory.findIndex((entry) => entry._id === item?._id);
  if (index === -1) return {};
  const changed = inventory.map((entry, i) =>
    i === index ? { ...entry, data: { ...entry.data, affixedTo: hostId || null } } : entry,
  );
  return {
    [`data.inventory.${index}.data.affixedTo`]: hostId || null,
    ...getAffixDisplayValues(changed),
  };
}

// The notice when the host already has a talisman or spellheart
function getAffixWarning(record, item, hostId) {
  if (!hostId || !isTalismanLike(item)) return "";
  const others = getAffixedItems(record, hostId).filter(
    (entry) => entry._id !== item._id && isTalismanLike(entry),
  );
  if (others.length === 0) return "";
  return `${others.map((entry) => entry.name).join(", ")} is already affixed there. More than one talisman or spellheart on an item deactivates them all until they're removed and affixed again.`;
}

// The item sheet's Affix button
function promptAffixItem(record, itemDataPath) {
  if (!itemDataPath || !itemDataPath.startsWith("data.inventory.")) {
    api.showNotification("Affix an item from a character's inventory.", "yellow", "Affix");
    return;
  }
  const item = api.getValue(itemDataPath);
  const hosts = getAffixHosts(record, item);
  const current = item?.data?.affixedTo || "";
  const options = hosts.map((host) => ({
    label: host._id === current ? `${host.name} (affixed now)` : host.name,
    value: host._id,
  }));
  if (current) options.push({ label: "Remove it", value: "none" });
  if (options.length === 0) {
    api.showNotification(`${item.name} has nothing to be affixed to (${item.data?.usage || "armor or a weapon"}).`, "yellow", "Affix");
    return;
  }
  api.showPrompt(
    `Affix ${item.name}`,
    "Affixing or removing it takes 10 minutes with a repair toolkit (Affix a Talisman).",
    "Choose an item...",
    options,
    null,
    (selected) => {
      const choice = getPromptSelections(selected)[0];
      if (!choice) return;
      const hostId = choice === "none" ? null : choice;
      const warning = getAffixWarning(record, item, hostId);
      if (warning) api.showNotification(warning, "yellow", "Affix");
      api.setValues(getAffixValues(record, item, hostId), (updated) => {
        onAddEditFeature(updated || record, undefined, true);
      });
      const host = hosts.find((entry) => entry._id === hostId);
      api.sendMessage(
        host
          ? `**${getCreatureName(record)}** affixes ${item.name} to ${host.name}.`
          : `**${getCreatureName(record)}** removes ${item.name}.`,
      );
    },
    "Affix",
    "Cancel",
    1,
  );
}

// Use's reminder for a talisman: not affixed, or deactivated by another
function getAffixedUseWarning(record, item) {
  if (!isTalismanLike(item)) return "";
  const host = getAffixHost(record, item);
  if (!host) return `${item.name} isn't affixed to an item. Affixing it takes 10 minutes (Affix a Talisman).`;
  if (getAffixedItems(record, host._id).filter(isTalismanLike).length > 1) {
    return `${host.name} has more than one talisman or spellheart affixed, which deactivates them all.`;
  }
  return "";
}

// A used talisman that's still in the inventory (the rest of a stack) isn't
// affixed any more: the values for useInventoryItem's write
function getUsedTalismanValues(record, item, itemDataPath) {
  if (!item?.data?.affixedTo || !isTalismanLike(item)) return {};
  const inventory = (record?.data?.inventory || []).map((entry) =>
    entry._id === item._id ? { ...entry, data: { ...entry.data, affixedTo: null } } : entry,
  );
  return { [`${itemDataPath}.data.affixedTo`]: null, ...getAffixDisplayValues(inventory) };
}

// The host row's Use button: uses what's affixed (picks when there's more
// than one)
function useAffixedItem(record, hostDataPath) {
  const host = api.getValue(hostDataPath);
  const inventory = record?.data?.inventory || [];
  const affixed = inventory
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.data?.affixedTo === host?._id);
  if (affixed.length === 0) {
    const values = getAffixDisplayValues(inventory);
    if (Object.keys(values).length > 0) api.setValues(values);
    return;
  }
  if (affixed.length === 1) {
    useInventoryItem(`data.inventory.${affixed[0].index}`);
    return;
  }
  api.showPrompt(
    `Use from ${host.name}`,
    "",
    "Choose...",
    affixed.map(({ item, index }) => ({ label: item.name, value: `${index}` })),
    null,
    (selected) => {
      const choice = getPromptSelections(selected)[0];
      if (choice !== undefined) useInventoryItem(`data.inventory.${choice}`);
    },
    "Use",
    "Cancel",
    1,
  );
}

// ---------------------------------------------------------------- Runes

// How many property runes an item uses: its potency value, or under
// Automatic Bonus Progression the character's attack or defense potency
// (GM Core pg. 224 and 85)
function getPropertyRuneLimit(record, item) {
  const abp = record ? getAbpBonuses(record) : null;
  if (abp) {
    return item?.data?.type === "weapon" || item?.data?.handwraps ? abp.attack : abp.defense;
  }
  return parseInt(item?.data?.runes?.potency || 0, 10) || 0;
}

// An item's property runes as a list. Some module records keep them as an
// object ({"0": ""}, the GM Core Handwraps of Mighty Blows); empty ones
// aren't runes
function getPropertyRuneList(item) {
  const property = item?.data?.runes?.property;
  const list = Array.isArray(property) ? property : Object.values(property || {});
  return list.filter((rune) => typeof rune === "string" && rune !== "");
}

function getActivePropertyRunes(record, item) {
  return getPropertyRuneList(item).slice(0, getPropertyRuneLimit(record, item));
}

function getDormantPropertyRunes(record, item) {
  return getPropertyRuneList(item).slice(getPropertyRuneLimit(record, item));
}

function getPropertyRuneName(rune, isWeapon) {
  return (isWeapon ? getWeaponRuneDetails(rune) : getArmorRuneDetails(rune))?.displayName || rune;
}

// The notice when property runes go past the limit, or ""
function getDormantRuneWarning(record, item) {
  const dormant = getDormantPropertyRunes(record, item);
  if (dormant.length === 0) return "";
  const isWeapon = item?.data?.type === "weapon" || !!item?.data?.handwraps;
  const limit = getPropertyRuneLimit(record, item);
  const names = dormant.map((rune) => getPropertyRuneName(rune, isWeapon)).join(", ");
  return `${item.name} can use ${limit} property rune${limit === 1 ? "" : "s"} (its potency value), so ${names} ${dormant.length === 1 ? "is" : "are"} dormant.`;
}

const RUNE_GRADE_WORDS = ["Greater", "Lesser", "Major", "Minor", "Moderate", "True", "Supreme"];
const REINFORCING_GRADES = ["Minor", "Lesser", "Moderate", "Greater", "Major", "Supreme"];
const FUNDAMENTAL_GRADES = ["", "Greater", "Major"];

// "Advancing (Greater)" -> "greaterAdvancing", the dropdowns' values
function getRuneValue(base, grade = "") {
  return `${grade} ${base}`
    .replace(/'/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word, i) => (i ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase()))
    .join("");
}

// What a rune item puts on gear: { kind, target, value, name }. kind is
// potency, striking, resilient, reinforcing or property; target is weapon,
// armor or shield. Energy-Resistant asks for its energy (energy: true).
// null when it isn't a rune this ruleset tracks
function parseRuneItem(item) {
  const name = (item?.name || "").trim();
  const usage = item?.data?.usage || "";
  if (!/^etched/.test(usage)) return null;
  let match = name.match(/^(Weapon|Armor) Potency \(\+(\d)\)$/i);
  if (match) {
    return { kind: "potency", target: match[1].toLowerCase(), value: parseInt(match[2], 10), name };
  }
  match = name.match(/^(Striking|Resilient)(?: \((Greater|Major)\))?$/i);
  if (match) {
    return {
      kind: match[1].toLowerCase(),
      target: /striking/i.test(match[1]) ? "weapon" : "armor",
      value: FUNDAMENTAL_GRADES.indexOf(match[2] ? capitalize(match[2].toLowerCase()) : "") + 1,
      name,
    };
  }
  match = name.match(/^Reinforcing Rune \((\w+)\)$/i);
  if (match) {
    const grade = REINFORCING_GRADES.indexOf(capitalize(match[1].toLowerCase())) + 1;
    return grade > 0 ? { kind: "reinforcing", target: "shield", value: grade, name } : null;
  }
  match = name.match(new RegExp(`^(.*?)(?: \\((${RUNE_GRADE_WORDS.join("|")})\\))?$`));
  const target = /armor/.test(usage) ? "armor" : /shield/.test(usage) ? "shield" : "weapon";
  if (/^energy[- ]resistant$/i.test(match[1])) {
    return { kind: "property", target: "armor", energy: true, grade: match[2] || "", name };
  }
  // A property rune the item sheet's dropdowns know (getPropertyRuneName
  // falls back to the value for one they don't)
  const value = getRuneValue(match[1], match[2] || "");
  if (target === "shield" || getPropertyRuneName(value, target === "weapon") === value) return null;
  return { kind: "property", target, value, name };
}

// An energy-resistant rune's value for the energy picked
function getEnergyResistantValue(grade, energy) {
  return getRuneValue(`${energy} Resistant`, grade);
}

// The character's items a rune can be etched on, by its usage
function getEtchHosts(record, runeItem, rune) {
  const usage = runeItem?.data?.usage || "";
  return (record?.data?.inventory || []).filter((item) => {
    const type = item.data?.type;
    if (rune.target === "weapon") {
      if (type !== "weapon" && !item.data?.handwraps) return false;
      return !/melee/.test(usage) || (parseInt(item.data?.range, 10) || 0) === 0;
    }
    if (rune.target === "shield") return type === "shield";
    if (type !== "armor") return false;
    const category = (item.data?.itemCategory || "").toLowerCase();
    if (/light-armor/.test(usage)) return category === "light";
    if (/heavy-armor/.test(usage)) return category === "heavy" || (/med/.test(usage) && category === "medium");
    return true;
  });
}

// A reinforcing rune's Hardness and HP on a shield (GM Core pg. 236): the
// shield's own values plus the rune's, up to the rune's maximums. The
// shield's own values are kept in baseHardness and baseHp while it has one
const REINFORCING_RUNE_BONUSES = {
  0: { hardness: 0, hp: 0, maxHardness: null, maxHp: null },
  1: { hardness: 3, hp: 44, maxHardness: 8, maxHp: 64 },
  2: { hardness: 3, hp: 52, maxHardness: 10, maxHp: 80 },
  3: { hardness: 3, hp: 64, maxHardness: 13, maxHp: 104 },
  4: { hardness: 5, hp: 80, maxHardness: 15, maxHp: 120 },
  5: { hardness: 5, hp: 84, maxHardness: 17, maxHp: 136 },
  6: { hardness: 7, hp: 108, maxHardness: 20, maxHp: 160 },
};

// The shield's data fields for a reinforcing rune (0: none):
// { "runes.reinforcing", hardness, "hp.max", "hp.value", baseHardness, baseHp }
function getReinforcingRuneData(shield, runeValue) {
  const grade = parseInt(runeValue || 0, 10) || 0;
  const data = shield?.data || {};
  const baseHardness = data.baseHardness || data.hardness || 0;
  const baseHp = data.baseHp || data.hp?.max || 0;
  const bonus = REINFORCING_RUNE_BONUSES[grade] || REINFORCING_RUNE_BONUSES[0];
  let hardness = baseHardness + bonus.hardness;
  let hpMax = baseHp + bonus.hp;
  if (bonus.maxHardness !== null) hardness = Math.min(hardness, bonus.maxHardness);
  if (bonus.maxHp !== null) hpMax = Math.min(hpMax, bonus.maxHp);
  // Current HP moves by the change in maximum
  const hpValue = Math.max(0, Math.min(hpMax, (data.hp?.value || 0) + hpMax - (data.hp?.max || 0)));
  return {
    "runes.reinforcing": grade ? `${grade}` : "",
    hardness,
    "hp.max": hpMax,
    "hp.value": hpValue,
    baseHardness: grade ? baseHardness : null,
    baseHp: grade ? baseHp : null,
  };
}

// Sets "a.b" paths of a data object, returning a copy
function setDataPaths(data, changes) {
  const result = { ...(data || {}) };
  Object.entries(changes).forEach(([path, value]) => {
    const keys = path.split(".");
    let target = result;
    keys.slice(0, -1).forEach((key) => {
      target[key] = { ...(target[key] || {}) };
      target = target[key];
    });
    target[keys[keys.length - 1]] = value;
  });
  return result;
}

// A host's data after a rune is etched, or { problem }
function getEtchedHostData(host, rune) {
  const runes = host?.data?.runes || {};
  const isWeapon = rune.target === "weapon";
  if (rune.kind === "property") {
    const property = getPropertyRuneList(host);
    if (property.includes(rune.value)) {
      return { problem: `${host.name} already has ${getPropertyRuneName(rune.value, isWeapon)}.` };
    }
    return { data: setDataPaths(host.data, { "runes.property": [...property, rune.value] }) };
  }
  if (rune.kind === "reinforcing") {
    if ((parseInt(runes.reinforcing, 10) || 0) >= rune.value) {
      return { problem: `${host.name} already has an equal or better reinforcing rune.` };
    }
    return { data: setDataPaths(host.data, getReinforcingRuneData(host, rune.value)) };
  }
  if ((parseInt(runes[rune.kind], 10) || 0) >= rune.value) {
    return { problem: `${host.name} already has an equal or better ${rune.kind} rune.` };
  }
  return { data: setDataPaths(host.data, { [`runes.${rune.kind}`]: `${rune.value}` }) };
}

// The one write that etches a rune item onto a host: the host's runes, and
// the rune item taken out of the inventory (one of a stack). { values,
// host } or { problem }
function getEtchValues(record, runeItem, rune, hostId) {
  const inventory = record?.data?.inventory || [];
  const host = inventory.find((item) => item._id === hostId);
  if (!host) return { problem: "That item isn't in the inventory any more." };
  const etched = getEtchedHostData(host, rune);
  if (etched.problem) return { problem: etched.problem };
  const newHost = { ...host, data: etched.data };
  newHost.fields = { ...(host.fields || {}), ...getItemFields(newHost) };
  const count = parseFloat(runeItem.data?.count || 1) || 1;
  const newInventory = inventory
    .map((item) => {
      if (item._id === hostId) return newHost;
      if (item._id === runeItem._id) {
        return count > 1 ? { ...item, data: { ...item.data, count: count - 1 } } : null;
      }
      return item;
    })
    .filter(Boolean);
  return { values: { "data.inventory": newInventory }, host: newHost };
}

// The item sheet's Etch button, for a rune item in a character's inventory
function promptEtchRune(record, itemDataPath) {
  if (!itemDataPath || !itemDataPath.startsWith("data.inventory.")) {
    api.showNotification("Etch a rune from a character's inventory.", "yellow", "Etch");
    return;
  }
  const runeItem = api.getValue(itemDataPath);
  const rune = parseRuneItem(runeItem);
  if (!rune) {
    api.showNotification(`${runeItem?.name || "This"} isn't a rune the sheet tracks: set it on the item's Rules section by hand.`, "yellow", "Etch");
    return;
  }
  if (rune.energy) {
    api.showPrompt(
      runeItem.name,
      "Which energy does it resist?",
      "Choose...",
      ["Acid", "Cold", "Electricity", "Fire"].map((energy) => ({ label: energy, value: energy })),
      null,
      (selected) => {
        const energy = getPromptSelections(selected)[0];
        if (energy) {
          promptEtchHost(record, runeItem, { ...rune, energy: false, value: getEnergyResistantValue(rune.grade, energy) });
        }
      },
      "OK",
      "Cancel",
      1,
    );
    return;
  }
  promptEtchHost(record, runeItem, rune);
}

function promptEtchHost(record, runeItem, rune) {
  const hosts = getEtchHosts(record, runeItem, rune);
  if (hosts.length === 0) {
    api.showNotification(`There's nothing in the inventory to etch ${runeItem.name} on.`, "yellow", "Etch");
    return;
  }
  api.showPrompt(
    `Etch ${runeItem.name}`,
    "Etching a rune is a Craft activity (GM Core pg. 225), or free from a runestone; the GM decides here.",
    "Choose an item...",
    hosts.map((host) => ({ label: host.name, value: host._id })),
    null,
    (selected) => {
      const hostId = getPromptSelections(selected)[0];
      if (!hostId) return;
      const result = getEtchValues(record, runeItem, rune, hostId);
      if (result.problem) {
        api.showNotification(result.problem, "yellow", "Etch");
        return;
      }
      const dormant = getDormantRuneWarning(record, result.host);
      if (dormant) api.showNotification(dormant, "yellow", "Dormant Rune");
      api.setValues(result.values, (updated) => {
        onAddEditFeature(updated || record, undefined, true);
      });
      api.sendMessage(`**${getCreatureName(record)}** etches ${runeItem.name} onto ${result.host.name}.`);
    },
    "Etch",
    "Cancel",
    1,
  );
}

// ---------------------------------------------------------------- Transferring runes

// The runes on an item that can be transferred: { kind, value, target, name }
// with the rune item's name (reinforcing runes stay, since they change the
// shield's own Hardness and HP)
function getItemRunes(item) {
  const runes = item?.data?.runes || {};
  const isWeapon = item?.data?.type === "weapon" || !!item?.data?.handwraps;
  const target = isWeapon ? "weapon" : "armor";
  const list = [];
  const potency = parseInt(runes.potency, 10) || 0;
  if (potency > 0) {
    list.push({ kind: "potency", target, value: potency, name: `${isWeapon ? "Weapon" : "Armor"} Potency (+${potency})` });
  }
  ["striking", "resilient"].forEach((kind) => {
    const grade = parseInt(runes[kind], 10) || 0;
    if (grade > 0 && (kind === "striking") === isWeapon) {
      const word = FUNDAMENTAL_GRADES[grade - 1];
      list.push({ kind, target, value: grade, name: `${capitalize(kind)}${word ? ` (${word})` : ""}` });
    }
  });
  getPropertyRuneList(item).forEach((value) => {
    list.push({ kind: "property", target, value, name: getRuneItemName(getPropertyRuneName(value, isWeapon)) });
  });
  return list;
}

// A property rune's display name as its rune item is named: "Greater
// Flaming" -> "Flaming (Greater)", "Acid Resistant" -> "Energy-Resistant"
function getRuneItemName(displayName) {
  const energy = displayName.match(/^(Greater )?(Acid|Cold|Electricity|Fire) Resistant$/);
  if (energy) return energy[1] ? "Energy-Resistant (Greater)" : "Energy-Resistant";
  const graded = displayName.match(new RegExp(`^(${RUNE_GRADE_WORDS.join("|")}) (.+)$`));
  return graded ? `${graded[2]} (${graded[1]})` : displayName;
}

// The items a rune can move to, not the one it's on. With the rune item,
// the ones its usage allows, as Etch (a melee weapon rune can't go on a
// ranged weapon: an automatic critical failure, GM Core pg. 225); without
// it, the same kind of item
function getTransferTargets(record, source, rune, runeRecord = null) {
  if (/^etched/.test(runeRecord?.data?.usage || "")) {
    return getEtchHosts(record, runeRecord, rune).filter((item) => item._id !== source._id);
  }
  return (record?.data?.inventory || []).filter((item) => {
    if (item._id === source._id) return false;
    const isWeapon = item.data?.type === "weapon" || !!item.data?.handwraps;
    return rune.target === "weapon" ? isWeapon : item.data?.type === "armor";
  });
}

// A transfer's Craft project (GM Core pg. 225): 1 day, the rune's level DC,
// 10% of its Price. runeRecord is the rune item, when it's found
function buildRuneTransferProject(record, source, target, rune, runeRecord) {
  const level = parseInt(runeRecord?.data?.level, 10) || parseInt(source.data?.level, 10) || 0;
  const priceCp = Math.round(getItemPriceCp(runeRecord) / 10);
  const formula = {
    _id: generateUuid(),
    name: `Transfer ${rune.name}`,
    portrait: runeRecord?.portrait || source.portrait,
    recordType: "items",
    identified: true,
    data: {
      type: "equipment",
      level,
      traits: ["Magical"],
      price: { value: { cp: priceCp, sp: 0, gp: 0, pp: 0 } },
      craftingDC: getCraftingDC({ data: { level } }),
      craftingQuantity: 1,
    },
  };
  const project = buildCraftProject(record, formula, {
    setupDays: 1,
    setupLabel: "1 day",
    output: "runeTransfer",
  });
  project.name = `Transfer ${rune.name} to ${target.name}`;
  project.data.transfer = {
    sourceId: source._id,
    targetId: target._id,
    kind: rune.kind,
    target: rune.target,
    value: rune.value,
    name: rune.name,
  };
  return project;
}

// Finishing a transfer: the rune comes off its item and goes on the other,
// as Etch puts it on (getEtchedHostData). The inventory write, or {} when
// either item is gone or the other item can't take it any more (it has the
// rune, or an equal or better one)
function getRuneTransferValues(record, transfer) {
  const inventory = record?.data?.inventory || [];
  const source = inventory.find((item) => item._id === transfer?.sourceId);
  const target = inventory.find((item) => item._id === transfer?.targetId);
  if (!source || !target) return {};
  const etched = getEtchedHostData(target, transfer);
  if (etched.problem) return {};
  const removed =
    transfer.kind === "property"
      ? { "runes.property": getPropertyRuneList(source).filter((value) => value !== transfer.value) }
      : { [`runes.${transfer.kind}`]: "" };
  return {
    "data.inventory": inventory.map((item) => {
      if (item._id === source._id) return { ...item, data: setDataPaths(item.data, removed) };
      if (item._id === target._id) return { ...item, data: etched.data };
      return item;
    }),
  };
}

// The Crafting tab's Transfer a Rune button: the item, the rune, where it
// goes, then the project (paying the materials) and its Craft check
function promptRuneTransfer(record) {
  const sources = (record?.data?.inventory || []).filter((item) => getItemRunes(item).length > 0);
  if (sources.length === 0) {
    api.showNotification("Nothing in the inventory has a rune to transfer.", "yellow", "Transfer a Rune");
    return;
  }
  const choose = (title, text, options, next) =>
    api.showPrompt(title, text, "Choose...", options, null, (selected) => {
      const choice = getPromptSelections(selected)[0];
      if (choice !== undefined) next(choice);
    }, "OK", "Cancel", 1);
  choose("Transfer a Rune", "Which item has the rune?", sources.map((item) => ({ label: item.name, value: item._id })), (sourceId) => {
    const source = sources.find((item) => item._id === sourceId);
    const runes = getItemRunes(source);
    choose("Transfer a Rune", `Which rune comes off ${source.name}?`, runes.map((rune, i) => ({ label: rune.name, value: `${i}` })), (runeIndex) => {
      const rune = runes[parseInt(runeIndex, 10)];
      // The rune item: its level and Price, and the items its usage allows
      api.getRecordsByQuery("items", { name: rune.name }, (records) => {
        const runeRecord = (records || [])[0] || null;
        const targets = getTransferTargets(record, source, rune, runeRecord);
        if (targets.length === 0) {
          api.showNotification(`There's nothing else in the inventory that can take ${rune.name}.`, "yellow", "Transfer a Rune");
          return;
        }
        choose("Transfer a Rune", `Move ${rune.name} to which item?`, targets.map((item) => ({ label: item.name, value: item._id })), (targetId) => {
          const target = targets.find((item) => item._id === targetId);
          // The same notice as Etch: it has the rune, or an equal or better one
          const problem = getEtchedHostData(target, rune).problem;
          if (problem) {
            api.showNotification(problem, "yellow", "Transfer a Rune");
            return;
          }
          startRuneTransfer(record._id, source, target, rune, runeRecord);
        });
      });
    });
  });
}

function startRuneTransfer(recordId, source, target, rune, runeRecord) {
  api.getRecord("characters", recordId, (record) => {
    if (!record) return;
    if (!hasFeatNamed(record, "Magical Crafting")) {
      api.showNotification("Transferring a rune needs you to be able to Craft magic items (Magical Crafting).", "yellow", "Transfer a Rune");
    }
    const project = buildRuneTransferProject(record, source, target, rune, runeRecord);
    project.data.coinPaidCp = project.data.paidCp;
    project.data.statusLabel = getCraftProjectStatus(project);
    const payment = getCoinPayment(record, project.data.paidCp);
    if (!payment) {
      api.showNotification(
        `The materials cost ${formatCp(project.data.paidCp)}, but you have ${formatCp(getCoinsCp(record))}.`,
        "red",
        "Not Enough Money",
      );
      return;
    }
    api.setValues(
      { ...payment, "data.craftingProjects": [...(record.data?.craftingProjects || []), project] },
      (updated) => rollCraftProject(updated || record, project),
    );
  });
}
