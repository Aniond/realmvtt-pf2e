// Spell pickers (H2 phase C): filling the empty rows the sheet's managed
// spellcasting entries make (spell-entries.js) without dragging spells in.
//   - Level Up ends with them, after the class sync has added the level's new
//     rows: one prompt per entry and rank with empty rows, for as many spells
//     as there are rows (a spontaneous caster's new repertoire spells,
//     cantrips). A prepared caster's slots wait for its daily preparations,
//     but a book (a wizard's spellbook, a witch's familiar: the entry's
//     Available Spells) gets the level's new spells.
//   - The creation wizard's Spells step and 1st level from level 0 fill a
//     book with what it starts with, then prepare its slots from it; a
//     cleric's or druid's slots are prepared from the compendium.
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

const isCantripSpell = (spell) =>
  (spell?.data?.traits || [])
    .map((trait) => `${typeof trait === "string" ? trait : trait?.name || ""}`.toLowerCase())
    .includes("cantrip");

const DIVINE_FONT_SPELLS = ["Heal", "Harm"];

const isDivineFontEntry = (entry) => /:font$/.test(`${entry?.data?.auto?.source || ""}`);

// An entry the pickers fill: one the sheet manages (not a focus or item
// entry, nor one whose slots the player turned off or whose source is gone)
function isPickableSpellEntry(entry) {
  return (
    isManagedSpellcastingEntry(entry) &&
    !isFocusEntry(entry) &&
    !isItemSpellsEntry(entry) &&
    entry.data?.autoSlots !== false &&
    !entry.data?.auto?.orphaned
  );
}

// A prepared class entry's book, the Available Spells it prepares from (a
// wizard's or magus's spellbook, a witch's familiar): what it holds at 1st
// level and gains each level, for the class's edition (CLASS_SPELLCASTING in
// spell-entries.js), or null. A cleric or druid prepares from the whole
// common list and has none. `curriculum` is set for a remastered wizard of a
// school with a curriculum, whose curriculum spells the player drags in.
function getSpellbookRules(entry, record) {
  if ((entry?.data?.type || "prepared") !== "prepared") return null;
  const match = /^class:([a-z-]+)$/.exec(`${entry?.data?.auto?.source || ""}`);
  if (!match) return null;
  const classObj = (record?.data?.classes || []).find(
    (classObj) => getClassSpellcasting(classObj)?.slug === match[1],
  );
  const casting = classObj ? getClassSpellcasting(classObj) : CLASS_SPELLCASTING[match[1]];
  if (!casting?.spellbook) return null;
  const school = casting.schoolSlot && record?.data?.flags?.[casting.schoolSlot.flag];
  return {
    ...casting.spellbook,
    curriculum: !!school && casting.edition !== "legacy" && !casting.schoolSlot.none.test(school),
  };
}

// The empty rows a picker can fill: one group per entry and rank, in the
// sheet's order. An entry still waiting on its tradition (a sorcerer before
// the bloodline) is left out, except the Divine Font, whose spells are fixed.
// Each group: { key, entryIndex, entryName, entryType, list, rank,
// rowIndexes, count, tradition, font }.
function getOpenSpellRowGroups(record) {
  const groups = [];
  (record?.data?.spells || []).forEach((entry, entryIndex) => {
    if (!isPickableSpellEntry(entry)) return;
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
        count: rowIndexes.length,
        tradition,
        font,
      });
    }
  });
  return groups;
}

// The spells a book gains (Wizard Spellcasting, Player Core pg. 192; the
// witch's familiar and the magus's spellbook the same). At 1st level (the
// creation wizard, 1st level from level 0): the cantrips and 1st-rank spells
// it starts with that aren't in it yet. At Level Up: the level's new spells,
// of any rank with slots. A school's curriculum spells (two 1st-rank spells,
// one more with each new rank) aren't picked here: the prompt says to drag
// them in, and the 1st-rank count leaves room for them.
// Each group: { key, entryIndex, entryName, entryType, book, rank, count,
// tradition, levelUp, curriculum }.
function getSpellbookGroups(record, levelUp = false) {
  const groups = [];
  (record?.data?.spells || []).forEach((entry, entryIndex) => {
    const rules = getSpellbookRules(entry, record);
    const tradition = `${entry.data?.tradition || ""}`.trim();
    if (!rules || !tradition || !isPickableSpellEntry(entry)) return;
    const group = {
      entryIndex,
      entryName: entry.name || "Spells",
      entryType: "prepared",
      book: rules.book,
      tradition,
      levelUp,
    };
    if (levelUp) {
      const rank = Math.max(
        0,
        ...SPELL_RANK_LISTS.filter((list) => (entry.data?.[list] || []).length > 0).map(getSpellListRank),
      );
      // A full caster's new rank comes at odd levels; curricula go to 9th
      const level = parseInt(record.data?.level, 10) || 0;
      const curriculum = rules.curriculum && rank <= 9 && rank === (level + 1) / 2;
      if (rank > 0) groups.push({ ...group, key: `${entry._id}:book`, rank, count: rules.perLevel, curriculum });
      return;
    }
    const known = entry.data?.knownSpells || [];
    const cantrips = known.filter(isCantripSpell).length;
    const spells = known.length - cantrips;
    if (rules.cantrips > cantrips) {
      groups.push({ ...group, key: `${entry._id}:book:cantrips`, rank: 0, count: rules.cantrips - cantrips });
    }
    const curriculum = rules.curriculum ? 2 : 0;
    if (rules.spells + curriculum > spells) {
      const count = Math.min(rules.spells, rules.spells + curriculum - spells);
      groups.push({ ...group, key: `${entry._id}:book:spells1`, rank: 1, count, curriculum: rules.curriculum });
    }
  });
  return groups;
}

// What the pickers offer, books first so their slots can be prepared from
// them. At Level Up a prepared caster's slots are left for its daily
// preparations (the Divine Font's are fixed, so they're filled); at 1st level
// a book's slots are prepared from the book, and wait for the wand while it
// has nothing of their rank.
function getSpellPickGroups(record, levelUp = false) {
  const slots = getOpenSpellRowGroups(record).filter((group) => {
    if (group.font || group.entryType !== "prepared") return true;
    if (levelUp) return false;
    const entry = record.data.spells[group.entryIndex];
    return !getSpellbookRules(entry, record) || getKnownSpellOptions(entry, group.rank).length > 0;
  });
  return [...getSpellbookGroups(record, levelUp), ...slots];
}

// A group's spells, as words ("5 cantrips", "2 1st-rank spells")
function getSpellGroupWhat(group) {
  const count = group.count;
  return group.rank === 0
    ? `${count} cantrip${count === 1 ? "" : "s"}`
    : `${count} ${getOrdinal(group.rank)}-rank spell${count === 1 ? "" : "s"}`;
}

// What's left to choose, one line per entry ("Sorcerer Spells: 5 cantrips
// and 2 1st-rank spells", "Wizard Spells: 10 cantrips and 5 1st-rank spells
// for your spellbook"), for the creation wizard's Spells step
function getOpenSpellRowsSummary(record) {
  const byEntry = new Map();
  for (const group of getSpellPickGroups(record)) {
    const parts = byEntry.get(group.entryName) || { book: null, books: [], slots: [] };
    if (group.book) {
      parts.book = group.book;
      parts.books.push(getSpellGroupWhat(group));
    } else {
      parts.slots.push(getSpellGroupWhat(group));
    }
    byEntry.set(group.entryName, parts);
  }
  const join = (list) =>
    list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
  return [...byEntry.entries()].map(([name, parts]) => {
    const lines = [
      ...(parts.books.length > 0 ? [`${join(parts.books)} for ${parts.book}`] : []),
      ...(parts.slots.length > 0 ? [join(parts.slots)] : []),
    ];
    return `${name}: ${lines.join("; ")}`;
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

// The value that adds the chosen spells to a book (Available Spells), each a
// copy with its own id, as a drop into the list makes
function getSpellbookValues(record, group, spells) {
  const entry = record.data.spells[group.entryIndex];
  return {
    [`data.spells.${group.entryIndex}.data.knownSpells`]: [
      ...(entry.data.knownSpells || []),
      ...spells.slice(0, group.count).map((spell) => ({ ...spell, _id: generateUuid() })),
    ],
  };
}

// The names of the spells in one of an entry's rank lists. A repertoire can
// hold a spell at more than one rank (Player Core pg. 297), so the picker
// only leaves out the ones already at this rank.
function getRankSpellNames(entry, list) {
  const names = (entry?.data?.[list] || [])
    .filter((row) => isFilledSpellRow(row) && row.name)
    .map((row) => row.name);
  return [...new Set(names)];
}

// A prepared entry's Available Spells of the group's rank (the wand offers
// those first, when there are any)
function getKnownSpellOptions(entry, rank) {
  return (entry?.data?.knownSpells || []).filter((spell) => {
    if (rank === 0) return isCantripSpell(spell);
    return !isCantripSpell(spell) && (parseInt(spell?.data?.level, 10) || 0) <= rank;
  });
}

// The prompt's title and text for a group
function getSpellPickPrompt(group) {
  const what = getSpellGroupWhat(group);
  const later = " Skip to choose later: the wand on an empty row picks one.";
  if (group.book) {
    const which = group.levelUp
      ? `${group.count} spell${group.count === 1 ? "" : "s"} of any rank you can cast`
      : `up to ${what}`;
    const curriculum = !group.curriculum
      ? ""
      : group.levelUp
        ? " Also drag a spell from your school's curriculum into Available Spells."
        : " Also drag your school's two 1st-rank curriculum spells into Available Spells.";
    return {
      title: `${group.entryName}: ${capitalize(group.book.replace(/^your /, ""))}`,
      text: `Add ${which} to ${group.book}.${curriculum} Skip to choose later: drag spells into Available Spells.`,
    };
  }
  const spontaneous = group.entryType === "spontaneous";
  const title = `${group.entryName}: ${group.rank === 0 ? "Cantrips" : `${getOrdinal(group.rank)}-Rank Spells`}`;
  const text = `${spontaneous ? "Add" : "Prepare"} up to ${what}${spontaneous ? " to your repertoire" : ""}.${later}`;
  return { title, text };
}

// Walks the groups, one prompt each, then calls next. Reads the record again
// before each, so each write lands on the rows as they are. levelUp: Level
// Up's picks (a book's new spells, no prepared slots). done holds the groups
// already offered (skipped or filled), so a skipped group isn't asked again.
function promptSpellPicks(recordId, next, levelUp = false, done = []) {
  api.getRecord("characters", recordId, (record) => {
    const group = getSpellPickGroups(record, levelUp).find((g) => !done.includes(g.key));
    if (!record || !group) {
      if (next) next();
      return;
    }
    const continueWith = () => promptSpellPicks(recordId, next, levelUp, [...done, group.key]);
    const fill = (spells) => {
      if (spells.length === 0) {
        continueWith();
        return;
      }
      const values = group.book
        ? getSpellbookValues(record, group, spells)
        : getSpellPickValues(record, group, spells);
      api.setValues(values, () => continueWith());
    };

    if (group.font) {
      promptDivineFontSpells(record, group, fill);
      return;
    }

    const entry = record.data.spells[group.entryIndex];
    const { title, text } = getSpellPickPrompt(group);
    const known =
      !group.book && group.entryType === "prepared" ? getKnownSpellOptions(entry, group.rank) : [];
    const options = known.length > 0 ? known.map((spell) => ({ value: spell._id, label: spell.name })) : null;
    let excludeNames = [];
    if (group.book) excludeNames = (entry.data?.knownSpells || []).map((spell) => spell?.name).filter(Boolean);
    else if (group.entryType === "spontaneous") excludeNames = getRankSpellNames(entry, group.list);
    const query = options === null ? getSpellSlotQuery(group.tradition, group.rank, excludeNames) : null;
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
        fill(spells.slice(0, group.count));
      },
      "OK",
      "Skip",
      group.count,
    );
  });
}

// One spell per name, the remastered record when the compendium has both
function getRemasterSpellsByName(spells, names) {
  const byName = new Map();
  for (const spell of spells || []) {
    if (!names.includes(spell?.name)) continue;
    const have = byName.get(spell.name);
    if (!have || (spell.data?.publication?.remaster === true && have.data?.publication?.remaster !== true)) {
      byName.set(spell.name, spell);
    }
  }
  return names.map((name) => byName.get(name)).filter(Boolean);
}

// The Divine Font's rows: every one gets the font's spell. With the font
// chosen (the class feature's flag, auto.spellFilter) it's looked up and
// filled; otherwise the player picks heal or harm.
function promptDivineFontSpells(record, group, fill) {
  const entry = record.data.spells[group.entryIndex];
  const filter = entry?.data?.auto?.spellFilter;
  const names = Array.isArray(filter) && filter.length === 1 ? [capitalize(filter[0])] : DIVINE_FONT_SPELLS;
  api.getRecordsByQuery("spells", { name: { $in: names } }, (spells) => {
    const found = getRemasterSpellsByName(spells, names);
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
