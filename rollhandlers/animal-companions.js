// Animal companions as characters (Player Core pg. 206-211, roadmap H14), as
// Foundry's PF2e Companion Compendia builds them: the companion's ancestry is
// its type (bear, wolf...), its class is "Animal Companion", and its stages
// (Mature, Nimble, Savage, Specialized) are feats, all in a data module. The
// ruleset's part is here and where common.js calls it:
//   - a character whose class is Animal Companion gets no Automatic Bonus
//     Progression (isAbpCharacter) and no attribute boosts at levels 5, 10,
//     15 and 20 (getLevelUpGains);
//   - the only item bonuses it benefits from are to AC and Speed, and its
//     armor's (barding's) item bonus to AC is at most +3 (Player Core pg. 206;
//     getEffectsAndModifiersForToken, getACForArmor);
//   - its level is its master's, set from the Notes tab's Master field and
//     its Match Master's Level button (there's no level-up hook).
// The extra damage dice of mature and specialized companions are the
// weaponDiceCount modifier (getAlteredWeapon).

// Whether a creature is an animal companion: its class is Animal Companion
// (by name, or data.animalCompanion on the class record)
function isAnimalCompanionCharacter(creature) {
  const classes = creature?.data?.classes || creature?.record?.data?.classes || [];
  return classes.some(
    (classObj) => toSlug(String(classObj?.name || "")) === "animal-companion" || classObj?.data?.animalCompanion === true,
  );
}

// Whether an ancestry is an animal companion type: flagged animalCompanion
// (the module's), or an animal rather than a humanoid. Such an ancestry has
// no heritages, so dropping it doesn't ask for one.
function isAnimalCompanionAncestry(ancestry) {
  if (ancestry?.data?.animalCompanion === true) return true;
  const traits = (ancestry?.data?.traits || []).map((trait) => String(trait?.name || trait).toLowerCase());
  return traits.includes("animal") && !traits.includes("humanoid");
}

// The modifier kinds an animal companion's item bonuses still count for
const ANIMAL_COMPANION_ITEM_BONUS_TYPES = ["armorClassBonus", "speedBonus", "speed"];

// An animal companion's modifiers without the item bonuses it can't benefit
// from (all but AC and Speed); item penalties still apply
function withoutAnimalCompanionItemBonuses(results) {
  return results.filter(
    (r) =>
      !(
        r.type === "item" &&
        `${r.modifierType || ""}`.endsWith("Bonus") &&
        !ANIMAL_COMPANION_ITEM_BONUS_TYPES.includes(r.modifierType) &&
        !(parseFloat(r.value) < 0)
      ),
  );
}

// The most an animal companion's armor (barding) adds to its AC as an item
// bonus, potency included
const ANIMAL_COMPANION_MAX_ARMOR_AC = 3;

// The companion's master's id, from the Notes tab's Master field (a record
// link, stored as JSON or as an object), or null
function getCompanionMasterId(record) {
  const master = record?.data?.companionMaster;
  if (!master) return null;
  if (typeof master === "object") return master._id || master.value?._id || null;
  try {
    const parsed = JSON.parse(master);
    return parsed?._id || parsed?.value?._id || null;
  } catch (error) {
    return null;
  }
}

// Brings an animal companion's level to its master's: reads the master and,
// when the levels differ, writes the level and works the sheet out again
// (onAddEditFeature). masterId may be passed in (the Master field's
// onchange value); callback(record) gets the record after.
function syncCompanionLevel(record, masterId = getCompanionMasterId(record), callback) {
  const done = (updated) => {
    if (callback) callback(updated);
  };
  if (!record || !masterId) return done(record);
  api.getRecord("characters", masterId, (master) => {
    const level = parseInt(master?.data?.level, 10);
    if (!(level >= 0)) return done(record);
    if (parseInt(record.data?.level, 10) === level) return done(record);
    api.setValuesOnRecord(record, { "data.level": level }, (updated) => {
      const current = updated || { ...record, data: { ...(record.data || {}), level } };
      onAddEditFeature(current, undefined, true);
      done(current);
    });
  });
}

// The Notes tab's Master field changed: the companion takes its master's
// level (value is the field's new record link)
function onCompanionMasterChange(value) {
  let masterId = null;
  if (value && typeof value === "object") masterId = value._id || value.value?._id || null;
  else if (value) {
    try {
      const parsed = JSON.parse(value);
      masterId = parsed?._id || parsed?.value?._id || null;
    } catch (error) {
      masterId = null;
    }
  }
  if (!masterId) return;
  syncCompanionLevel(record, masterId, (updated) => {
    const level = updated?.data?.level;
    if (level !== undefined) {
      api.showNotification(`${record?.name || "The companion"} is now level ${level}, as its master is.`, "green", "Animal Companion");
    }
  });
}

// The Notes tab's Match Master's Level button
function onCompanionMatchLevel() {
  if (!getCompanionMasterId(record)) {
    api.showNotification("Choose the companion's master first.", "yellow", "Animal Companion");
    return;
  }
  syncCompanionLevel(record, getCompanionMasterId(record), (updated) => {
    api.showNotification(`${record?.name || "The companion"} is level ${updated?.data?.level}, as its master is.`, "green", "Animal Companion");
  });
}
