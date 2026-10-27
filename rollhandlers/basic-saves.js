// Basic saves applied per target: area spells and monster abilities roll
// damage once, and each target takes none, half, full or double by its own
// save (Player Core pg. 405, Basic Saving Throws).
//   - save.js keeps each save's result on the saver's token (data.lastSave),
//     whichever order the saves and the damage are rolled in;
//   - the damage card of a spell with a basic save, or of an ability's damage
//     button, has an Apply by Saves button: for each selected creature it
//     applies the damage by that creature's last save, says what each took,
//     and clears the save so it can't be used twice.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// How long a save stays good for Apply by Saves
const LAST_SAVE_MINUTES = 10;

const BASIC_SAVE_RESULTS = {
  2: { name: "critical success", label: "no damage", multiplier: 0 },
  1: { name: "success", label: "half damage", multiplier: 0.5 },
  0: { name: "failure", label: "full damage", multiplier: 1 },
  "-1": { name: "critical failure", label: "double damage", multiplier: 2 },
};

// The token a save is rolled for, for save.js to keep its result on: the
// token itself, or a character sheet's token. { id, recordType } or null.
function getSaverTokenRef(record) {
  if (!record?._id) return null;
  // A token (from the selection or the tracker) links to its record
  if (record.recordId) return { id: record._id, recordType: record.recordType };
  const token = typeof api?.getToken === "function" ? api.getToken() : null;
  if (token?._id && token.recordId === record._id) {
    return { id: token._id, recordType: token.recordType };
  }
  return null;
}

// The values that keep a save's result on the saver's token, or null
function getLastSaveValues(metadata, degree) {
  if (!metadata?.saverTokenId || !Number.isFinite(degree)) return null;
  return {
    "data.lastSave": {
      degree,
      saveType: metadata.saveType || "",
      dc: parseInt(metadata.dc, 10) || 0,
      time: Date.now(),
    },
  };
}

// The save card's line for a basic save, or ""
function getBasicSaveLine(metadata, degree) {
  if (!metadata?.basicSave || !Number.isFinite(degree)) return "";
  const result = BASIC_SAVE_RESULTS[degree];
  return result ? `**Basic save:** ${result.label}.` : "";
}

// A creature's last save, if it is recent enough (and of the save type,
// when the damage names one), or null
function getRecentSave(creature, saveType = "", now = Date.now()) {
  const save = creature?.data?.lastSave || creature?.record?.data?.lastSave;
  if (!save || !Number.isFinite(save.degree) || !Number.isFinite(save.time)) return null;
  if (now - save.time > LAST_SAVE_MINUTES * 60 * 1000) return null;
  if (saveType && save.saveType && save.saveType !== saveType) return null;
  return save;
}

// The damage card's Apply by Saves button. The roll's metadata.basicSave
// ({ saveType }) names the save when it is known (a spell's).
function getApplyBySavesButton(roll) {
  const fence = "```";
  return `${fence}Apply_by_Saves\napplyDamageBySaves(${JSON.stringify(roll)});\n${fence}`;
}

// Applies damage to each selected creature by its last save, and posts what
// each took
function applyDamageBySaves(roll) {
  const saveType = roll?.metadata?.basicSave?.saveType || "";
  const creatures = (api.getSelectedOrDroppedToken() || []).map((t) => t?.token || t).filter(Boolean);
  if (creatures.length === 0) {
    api.showNotification("Select the creatures that saved, then click again.", "yellow", "Notice");
    return;
  }
  const lines = [];
  creatures.forEach((creature) => {
    const name = getTokenDisplayName(creature);
    const save = getRecentSave(creature, saveType);
    if (!save) {
      lines.push(`- ${name}: no ${saveType ? `${capitalize(saveType)} ` : ""}save rolled, nothing applied`);
      return;
    }
    const result = BASIC_SAVE_RESULTS[save.degree];
    lines.push(`- ${name}: ${capitalize(save.saveType || "save")} ${result.name}, ${result.label}`);
    if (result.multiplier === 0.5) {
      applyDamage(creature, roll, true);
    } else if (result.multiplier === 1) {
      applyDamage(creature, roll, false);
    } else if (result.multiplier === 2) {
      applyDamage(creature, { ...roll, metadata: { ...(roll?.metadata || {}), critical: true } }, false);
    }
    // Used: the next damage needs a new save
    api.setValuesOnTokenById(creature._id, creature.recordType, { "data.lastSave": null });
  });
  const source = roll?.metadata?.attack || roll?.metadata?.rollName || "Damage";
  api.sendMessage(`**${source}: applied by saves**\n${lines.join("\n")}`);
}
