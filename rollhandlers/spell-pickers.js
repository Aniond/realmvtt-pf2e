// Spell pickers (H2 phase C): filling the empty rows the sheet's managed
// spellcasting entries make (spell-entries.js) without dragging spells in.
//   - Level Up ends with them, after the class sync has added the level's new
//     rows: one prompt per entry and rank with empty rows, for as many spells
//     as there are rows (a spontaneous caster's new repertoire spells,
//     cantrips, a prepared caster's new slots). The creation wizard's Spells
//     step and 1st level from level 0 run the same prompts.
//   - The Divine Font's rows take heal or harm only: filled with the font the
//     class feature chose, or the player picks one.
//   - Each prompt can be skipped, and every row keeps its wand to pick one
//     later. Nothing is refused: rarity is the GM's call (Player Core pg. 15),
//     so uncommon spells are listed too, as the wand's list does.
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

// A spell's defense as the spell row shows it ("AC", "Basic Reflex")
function getSpellDefenseString(defense) {
  if (!defense && !defense?.passive && !defense?.save) {
    return "";
  }
  let defenseString = "";
  if (defense?.passive?.statistic) {
    let passiveStatistic = defense?.passive?.statistic;
    if (passiveStatistic === "ac") {
      passiveStatistic = "AC";
    } else if (passiveStatistic === "fortitude-dc") {
      passiveStatistic = "Fortitude DC";
    } else if (passiveStatistic === "reflex-dc") {
      passiveStatistic = "Reflex DC";
    } else if (passiveStatistic === "will-dc") {
      passiveStatistic = "Will DC";
    }
    defenseString += `${passiveStatistic} `;
  }
  if (defense?.save?.basic) {
    if (defenseString.length > 0) {
      defenseString += " |";
    }
    defenseString += " Basic";
  }
  if (defense?.save?.statistic) {
    if (defenseString.length > 0) {
      defenseString += " ";
    }
    defenseString += `${capitalize(defense?.save?.statistic)} `;
  }
  return defenseString.trim();
}

// A spell put into a row of an entry of this type, keeping the row's id and
// order (the spell list's drop and the pickers)
function buildFilledSpellRow(slotRow, spell, entryType) {
  const isCantrip = (spell?.data?.traits || [])
    .map((trait) => `${typeof trait === "string" ? trait : trait?.name || ""}`.toLowerCase())
    .includes("cantrip");
  const isSpontaneousOrFocus =
    entryType === "spontaneous" || entryType === "innate" || entryType === "focus";
  return {
    ...spell,
    _id: slotRow?._id,
    data: {
      type: "spell",
      ...spell?.data,
      level: spell?.data?.level,
      slotOrder: slotRow?.data?.slotOrder,
      defenseString: getSpellDefenseString(spell?.data?.defense),
    },
    fields: {
      ...(spell?.fields || {}),
      spellDetails: { hidden: false },
      spellSlot: { hidden: true },
      innateBox: { hidden: entryType !== "innate" || isCantrip },
      used: { hidden: isCantrip || isSpontaneousOrFocus },
      // Signature spells: spontaneous casters only (check-tools.js)
      signatureBox: { hidden: entryType !== "spontaneous" || isCantrip },
    },
  };
}

// The compendium query for a row of a rank (0 for cantrips): the tradition's
// spells (by its traditions or a tradition trait) up to that rank, cantrips
// only in cantrip rows. excludeNames leaves out spells the entry has.
function getSpellSlotQuery(tradition, rank, excludeNames = []) {
  const traditionMatch = { $elemMatch: { $regex: `^${tradition}$`, $options: "i" } };
  const cantripMatch = { $elemMatch: { $regex: "^cantrip$", $options: "i" } };
  return {
    type: "spells",
    query: {
      $or: [
        { "data.level": { $lte: rank === 0 ? 1 : rank } },
        { "data.level": { $exists: false } },
        { "data.level": null },
      ],
      $and: [
        { $or: [{ "data.traits": traditionMatch }, { "data.traditions": traditionMatch }] },
        rank === 0 ? { "data.traits": cantripMatch } : { "data.traits": { $not: cantripMatch } },
        ...(excludeNames.length > 0 ? [{ name: { $nin: excludeNames } }] : []),
      ],
    },
  };
}

// The rank of a spell list ("cantrips" 0, "spells3" 3)
function getSpellListRank(list) {
  return list === "cantrips" ? 0 : parseInt(`${list}`.replace("spells", ""), 10) || 0;
}

const DIVINE_FONT_SPELLS = ["Heal", "Harm"];

const isDivineFontEntry = (entry) => /:font$/.test(`${entry?.data?.auto?.source || ""}`);

// The empty rows a picker can fill: one group per entry and rank, in the
// sheet's order, for the entries the sheet manages (not focus or item
// entries, nor one whose slots the player turned off or whose source is
// gone). An entry still waiting on its tradition (a sorcerer before the
// bloodline) is left out, except the Divine Font, whose spells are fixed.
// Each group: { key, entryIndex, entryName, entryType, list, rank,
// rowIndexes, tradition, font }.
function getOpenSpellRowGroups(record) {
  const groups = [];
  (record?.data?.spells || []).forEach((entry, entryIndex) => {
    if (!isManagedSpellcastingEntry(entry) || isFocusEntry(entry) || isItemSpellsEntry(entry)) return;
    if (entry.data?.autoSlots === false || entry.data?.auto?.orphaned) return;
    const font = isDivineFontEntry(entry);
    const tradition = `${entry.data?.tradition || ""}`.trim();
    if (!font && !tradition) return;
    for (const list of SPELL_RANK_LISTS) {
      const rowIndexes = [];
      (entry.data?.[list] || []).forEach((row, rowIndex) => {
        if (!isFilledSpellRow(row)) rowIndexes.push(rowIndex);
      });
      if (rowIndexes.length === 0) continue;
      groups.push({
        key: `${entry._id}:${list}`,
        entryIndex,
        entryName: entry.name || "Spells",
        entryType: entry.data?.type || "prepared",
        list,
        rank: getSpellListRank(list),
        rowIndexes,
        tradition,
        font,
      });
    }
  });
  return groups;
}

// What's left to choose, one line per entry ("Sorcerer Spells: 5 cantrips
// and 2 1st-rank spells"), for the creation wizard's Spells step
function getOpenSpellRowsSummary(record) {
  const byEntry = new Map();
  for (const group of getOpenSpellRowGroups(record)) {
    const count = group.rowIndexes.length;
    const what =
      group.rank === 0
        ? `${count} cantrip${count === 1 ? "" : "s"}`
        : `${count} ${getOrdinal(group.rank)}-rank spell${count === 1 ? "" : "s"}`;
    byEntry.set(group.entryName, [...(byEntry.get(group.entryName) || []), what]);
  }
  return [...byEntry.entries()].map(([name, parts]) => {
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
    return `${name}: ${list}`;
  });
}

// The values that put the chosen spells into a group's empty rows, in order
// (more spells than rows: the rest are left out)
function getSpellPickValues(record, group, spells) {
  const entry = record.data.spells[group.entryIndex];
  const rows = entry.data[group.list] || [];
  const valuesToSet = {};
  spells.slice(0, group.rowIndexes.length).forEach((spell, i) => {
    const rowIndex = group.rowIndexes[i];
    valuesToSet[`data.spells.${group.entryIndex}.data.${group.list}.${rowIndex}`] = buildFilledSpellRow(
      rows[rowIndex],
      spell,
      group.entryType,
    );
  });
  return valuesToSet;
}

// The names of the spells already in an entry: a repertoire learns a spell
// once, so its picker leaves them out (prepared slots can repeat a spell)
function getEntrySpellNames(entry) {
  const names = [];
  for (const list of SPELL_RANK_LISTS) {
    for (const row of entry?.data?.[list] || []) {
      if (isFilledSpellRow(row) && row.name) names.push(row.name);
    }
  }
  return [...new Set(names)];
}

// A prepared entry's Available Spells of the group's rank (the wand offers
// those first, when there are any)
function getKnownSpellOptions(entry, rank) {
  return (entry?.data?.knownSpells || []).filter((spell) => {
    const traits = (spell?.data?.traits || []).map((trait) =>
      `${typeof trait === "string" ? trait : trait?.name || ""}`.toLowerCase(),
    );
    const isCantrip = traits.includes("cantrip");
    if (rank === 0) return isCantrip;
    return !isCantrip && (parseInt(spell?.data?.level, 10) || 0) <= rank;
  });
}

// The prompt's title and text for a group
function getSpellPickPrompt(group) {
  const count = group.rowIndexes.length;
  const spontaneous = group.entryType === "spontaneous";
  const what =
    group.rank === 0
      ? `${count} cantrip${count === 1 ? "" : "s"}`
      : `${count} ${getOrdinal(group.rank)}-rank spell${count === 1 ? "" : "s"}`;
  const title = `${group.entryName}: ${group.rank === 0 ? "Cantrips" : `${getOrdinal(group.rank)}-Rank Spells`}`;
  const text = `${spontaneous ? "Add" : "Prepare"} up to ${what}${
    spontaneous ? " to your repertoire" : ""
  }. Skip to choose later: the wand on an empty row picks one.`;
  return { title, text };
}

// Walks the empty rows, one prompt per group, then calls next. Reads the
// record again before each, so each write lands on the rows as they are.
// done holds the groups already offered (skipped or filled), so a skipped
// group isn't asked again.
function promptSpellPicks(recordId, next, done = []) {
  api.getRecord("characters", recordId, (record) => {
    const group = getOpenSpellRowGroups(record).find((g) => !done.includes(g.key));
    if (!record || !group) {
      if (next) next();
      return;
    }
    const continueWith = () => promptSpellPicks(recordId, next, [...done, group.key]);
    const fill = (spells) => {
      if (spells.length === 0) {
        continueWith();
        return;
      }
      api.setValues(getSpellPickValues(record, group, spells), () => continueWith());
    };

    if (group.font) {
      promptDivineFontSpells(record, group, fill);
      return;
    }

    const entry = record.data.spells[group.entryIndex];
    const count = group.rowIndexes.length;
    const { title, text } = getSpellPickPrompt(group);
    const known = group.entryType === "prepared" ? getKnownSpellOptions(entry, group.rank) : [];
    const options = known.length > 0 ? known.map((spell) => ({ value: spell._id, label: spell.name })) : null;
    const query =
      options === null
        ? getSpellSlotQuery(
            group.tradition,
            group.rank,
            group.entryType === "spontaneous" ? getEntrySpellNames(entry) : [],
          )
        : null;
    api.showPrompt(
      title,
      text,
      group.rank === 0 ? "Select Cantrips..." : "Select Spells...",
      options,
      query,
      (selected) => {
        const spells = getPromptSelections(selected)
          .map((value) => (typeof value === "string" ? known.find((spell) => spell._id === value) : value))
          .filter((spell) => spell && typeof spell === "object");
        fill(spells.slice(0, count));
      },
      "OK",
      "Skip",
      count,
    );
  });
}

// The Divine Font's rows: every one gets the font's spell. With the font
// chosen (the class feature's flag, auto.spellFilter) it's looked up and
// filled; otherwise the player picks heal or harm.
function promptDivineFontSpells(record, group, fill) {
  const entry = record.data.spells[group.entryIndex];
  const filter = entry?.data?.auto?.spellFilter;
  const names = Array.isArray(filter) && filter.length === 1 ? [capitalize(filter[0])] : DIVINE_FONT_SPELLS;
  api.getRecordsByQuery("spells", { name: { $in: names } }, (spells) => {
    const found = (spells || []).filter((spell) => names.includes(spell?.name));
    const fillAll = (spell) => fill(spell ? group.rowIndexes.map(() => spell) : []);
    if (names.length === 1 || found.length === 1) {
      fillAll(found[0]);
      return;
    }
    if (found.length === 0) {
      fillAll(null);
      return;
    }
    api.showPrompt(
      "Divine Font",
      `Your Divine Font's ${group.rowIndexes.length} ${getOrdinal(group.rank)}-rank slot${
        group.rowIndexes.length === 1 ? "" : "s"
      } take heal or harm, as your deity grants.`,
      "Heal or Harm...",
      found.map((spell) => ({ value: spell._id, label: spell.name })),
      null,
      (selected) => {
        const id = getPromptSelections(selected)[0];
        fillAll(found.find((spell) => spell._id === (typeof id === "object" ? id?._id : id)));
      },
      "OK",
      "Skip",
      1,
    );
  });
}
