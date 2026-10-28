// Casting from scrolls and wands with the character's own spellcasting
// (GM Core pg. 262 Scrolls, pg. 282 Wands), and Trick Magic Item for a
// character without the spell's tradition (Player Core pg. 264).
//   - Use on a scroll or wand finds its spell (the item's Spell field, or the
//     spell its description links) and the rank (Level field, "(3rd-Rank
//     Spell)" in its name, or "at 3rd-rank" in its text);
//   - a character with a prepared or spontaneous entry of the spell's
//     tradition casts it: the spell goes in an automatic "Scrolls and Wands"
//     entry (type item, data.itemSpells) at the item's rank, with the DC,
//     attack, attribute and tradition copied from their best matching entry
//     on every cast, and castSpell does the rest. The entry is left out of
//     slots, daily preparations, level up and the class's entries;
//   - otherwise the card offers the Trick Magic Item check and a button to
//     cast once it succeeds;
//   - a scroll is used up; a wand spends its once-a-day use, which comes back
//     at daily preparations. Casting a spent wand only warns (overcharge).
// Loaded as one of the ruleset's scripts (ruleset.config.json,
// otherSettings.scripts), so it shares common.js's scope at runtime.

const ITEM_SPELLS_ENTRY_NAME = "Scrolls and Wands";

// The skill each tradition's Trick Magic Item check uses
const TRADITION_SKILLS = {
  arcane: "arcana",
  divine: "religion",
  occult: "occultism",
  primal: "nature",
};

function getItemTraitNames(item) {
  return getTraitNameList(item?.data?.traits || []);
}

// "wand", "scroll", or null: by the wand or scroll trait, or Foundry's item
// category. Other consumables are left as they are.
function getItemSpellKind(item) {
  const traits = getItemTraitNames(item);
  const category = String(item?.data?.itemCategory || "").trim().toLowerCase();
  if (traits.includes("wand") || category === "wand") return "wand";
  if (traits.includes("scroll") || category === "scroll") return "scroll";
  return null;
}

// The spell a scroll or wand holds: { _id, name } from its Spell field, or
// the first spell its description links, or null
function getItemSpellRef(item) {
  const field = item?.data?.spell;
  if (field) {
    try {
      const ref = typeof field === "string" ? JSON.parse(field) : field;
      if (ref?._id || ref?.name) return { _id: ref._id || "", name: ref.name || "" };
    } catch (e) {
      // not JSON: fall through to the description
    }
  }
  const description = String(item?.data?.description || "").replace(/&quot;/g, '"');
  const pattern = /recordlink="(\{.*?\})"/g;
  for (const match of description.matchAll(pattern)) {
    try {
      const link = JSON.parse(match[1]);
      const value = link?.value || {};
      if (value.recordType === "spells" && (value._id || value.name)) {
        return { _id: value._id || "", name: value.name || "" };
      }
    } catch (e) {
      // a link we can't read
    }
  }
  return null;
}

// The rank the item casts at, or null for the spell's own: the Level field,
// "(3rd-Rank Spell)" in its name, or "at 3rd-rank" in its text (legacy:
// level)
function getItemSpellRank(item) {
  const field = parseInt(item?.data?.spellLevel, 10);
  if (field > 0) return field;
  const pattern = /(\d+)(?:st|nd|rd|th)[- ](?:rank|level)/i;
  const fromName = String(item?.name || "").match(pattern);
  if (fromName) return parseInt(fromName[1], 10);
  const fromText = String(item?.data?.description || "").match(pattern);
  return fromText ? parseInt(fromText[1], 10) : null;
}

// The traditions that have the spell: its traditions, or tradition traits
function getSpellTraditions(spell) {
  const names = [
    ...(Array.isArray(spell?.data?.traditions) ? spell.data.traditions : []),
    ...(spell?.data?.traits || []),
  ].map((name) => String(typeof name === "string" ? name : name?.name || "").trim().toLowerCase());
  return Object.keys(TRADITION_SKILLS).filter((tradition) => names.includes(tradition));
}

function isItemSpellsEntry(entry) {
  return entry?.data?.itemSpells === true || entry?.data?.itemSpells === "true";
}

// A character's prepared and spontaneous entries (not focus, innate or
// item), with their index
function getCastingEntries(record) {
  return (record?.data?.spells || [])
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      const type = entry?.data?.type || "prepared";
      return (type === "prepared" || type === "spontaneous") && !isItemSpellsEntry(entry);
    });
}

// The character's best entry (highest DC) of one of the traditions, or null
function getBestCastingEntry(record, traditions) {
  const matching = getCastingEntries(record).filter(({ entry }) =>
    traditions.includes(String(entry?.data?.tradition || "").trim().toLowerCase()),
  );
  matching.sort((a, b) => (parseInt(b.entry.data?.dc, 10) || 0) - (parseInt(a.entry.data?.dc, 10) || 0));
  return matching[0]?.entry || null;
}

// The DC and attack Trick Magic Item casts with (Player Core pg. 264): a
// character with spell DC proficiency uses their best entry; one without
// uses their level as the proficiency bonus (trained's if master in the
// skill, expert's if legendary) and the highest of Int, Wis and Cha
function getTrickMagicItemCasting(record, skill, tradition) {
  const best = getCastingEntries(record).sort(
    (a, b) => (parseInt(b.entry.data?.dc, 10) || 0) - (parseInt(a.entry.data?.dc, 10) || 0),
  )[0]?.entry;
  if (best) {
    return {
      dc: parseInt(best.data?.dc, 10) || 0,
      mod: parseInt(best.data?.mod, 10) || 0,
      attribute: best.data?.attribute || "int",
      tradition: capitalize(tradition),
    };
  }
  const level = parseInt(record?.data?.level, 10) || 1;
  const rank = parseInt(record?.data?.[skill] || "0", 10) || 0;
  const proficiency = level + (rank >= 4 ? 4 : rank >= 3 ? 2 : 0);
  const attributes = ["int", "wis", "cha"].map((attribute) => ({
    attribute,
    value: parseInt(record?.data?.[attribute] || "0", 10) || 0,
  }));
  attributes.sort((a, b) => b.value - a.value);
  const mod = proficiency + attributes[0].value;
  return { dc: 10 + mod, mod, attribute: attributes[0].attribute, tradition: capitalize(tradition) };
}

// The character's entries with the spell in the Scrolls and Wands entry at
// the rank, and that entry's DC, attack, attribute and tradition set from
// `casting`: { entries, path }. The same spell at the same rank reuses its
// row, so an older card's buttons still find it.
function getItemSpellEntries(record, spell, rank, casting) {
  const entries = JSON.parse(JSON.stringify(record?.data?.spells || []));
  let index = entries.findIndex(isItemSpellsEntry);
  if (index < 0) {
    entries.push(
      buildSpellcastingEntry({
        name: ITEM_SPELLS_ENTRY_NAME,
        type: "item",
        shownSpells: [],
        isFirst: entries.length === 0,
      }),
    );
    index = entries.length - 1;
  }
  const entry = entries[index];
  const list = `spells${rank}`;
  const shown = Array.isArray(entry.data?.shownSpells) ? entry.data.shownSpells : [];
  entry.data = {
    ...entry.data,
    type: "item",
    itemSpells: true,
    tradition: casting.tradition,
    attribute: casting.attribute,
    dc: casting.dc,
    mod: casting.mod,
    shownSpells: shown.includes(list) ? shown : [...shown, list],
  };
  entry.fields = { ...(entry.fields || {}), [`${list}Box`]: { hidden: false } };
  const rows = Array.isArray(entry.data[list]) ? entry.data[list] : [];
  const row = {
    _id: spell._id,
    name: spell.name,
    portrait: spell.portrait,
    recordType: "spells",
    data: { ...(spell.data || {}), uses: 1, maxUses: 0 },
    fields: {},
  };
  let rowIndex = rows.findIndex((r) => r?._id === spell._id || r?.name === spell.name);
  if (rowIndex < 0) {
    rows.push(row);
    rowIndex = rows.length - 1;
  } else {
    rows[rowIndex] = row;
  }
  entry.data[list] = rows;
  return { entries, path: `data.spells.${index}.data.${list}.${rowIndex}` };
}

// The spell's record: by id, then by name (a description links the module's
// spell, and the campaign's copy has another id)
function findItemSpell(ref, callback) {
  const byName = () => {
    if (!ref?.name) return callback(null);
    api.getRecordByTypeAndName("spells", ref.name, (spell) => callback(spell || null));
  };
  if (!ref?._id) return byName();
  api.getRecord("spells", ref._id, (spell) => (spell ? callback(spell) : byName()));
}

// Casts the spell into the Scrolls and Wands entry and posts its card
function castItemSpellWith(record, item, spell, rank, casting, note = "") {
  const castRank = rank || parseInt(spell?.data?.level, 10) || 1;
  const { entries, path } = getItemSpellEntries(record, spell, castRank, casting);
  const ordinal = getOrdinal(castRank);
  api.sendMessage(
    `**${getTokenDisplayName(record)}** casts ${spell.name} (${ordinal} rank) from ${item.name}, with ${casting.tradition} spell DC ${casting.dc} and attack +${casting.mod}.${note ? `\n${note}` : ""}`,
  );
  api.setValuesOnRecord(record, { "data.spells": entries }, (updated) => {
    const target = updated || { ...record, data: { ...record.data, spells: entries } };
    castSpell(target, api.getValueOnRecord(target, path), path);
  });
}

// The Trick Magic Item card: the check for each tradition's skill against
// the item's level-based DC, and a button to cast once it succeeds
function getTrickMagicItemCard(record, item, spell, traditions) {
  const dc = getDCForLevel(parseInt(item?.data?.level, 10) || 1);
  const fence = "```";
  const checks = traditions
    .map((tradition) => {
      const skill = TRADITION_SKILLS[tradition];
      return `${fence}Trick_Magic_Item_${capitalize(skill)}_DC${dc}\nrollSkillCheck(${JSON.stringify(skill)}, ${dc}, { action: "Trick Magic Item" });\n${fence}`;
    })
    .join("\n");
  const cast = `${fence}Cast_After_Trick_Magic_Item\ncastItemSpellByTrick(${JSON.stringify(record._id)}, ${JSON.stringify(item._id)}, ${JSON.stringify(traditions)});\n${fence}`;
  return `#### Trick Magic Item: ${item.name}
${getTokenDisplayName(record)} has no ${traditions.map(capitalize).join(" or ")} spellcasting for ${spell.name}. On a success, cast it this turn; on a failure, try again next turn; on a critical failure, not until your next daily preparations (Player Core pg. 264).
${checks}
${cast}`;
}

// The values that spend a scroll (one fewer) or a wand's use for the day,
// and the card's line for an overcharge, or "": { values, line }
function getItemSpellUseValues(item, itemPath, kind) {
  if (kind === "wand") {
    const left = parseInt(item?.data?.uses?.value, 10);
    if (left > 0) {
      return { values: { [`${itemPath}.data.uses.value`]: left - 1 }, line: "" };
    }
    return {
      values: {},
      line: `**Overcharge:** ${item.name} was already used today. Roll a DC 10 flat check: on a success the wand is broken, on a failure it's destroyed. A wand already overcharged today is destroyed and casts nothing (GM Core pg. 282).`,
    };
  }
  const count = parseInt(item?.data?.count, 10) || 0;
  return { values: { [`${itemPath}.data.count`]: Math.max(0, count - 1) }, line: "" };
}

// Use on a scroll or wand from the sheet: casts its spell, or offers Trick
// Magic Item. Returns false for anything else (or a creature that isn't a
// character), which Use handles as before.
function useItemSpell(record, item, itemPath) {
  const kind = getItemSpellKind(item);
  const ref = kind ? getItemSpellRef(item) : null;
  if (!ref || record?.recordType !== "characters") return false;
  const rank = getItemSpellRank(item);
  findItemSpell(ref, (spell) => {
    if (!spell) {
      api.showNotification(`The spell in ${item.name} (${ref.name}) wasn't found.`, "yellow", item.name);
      return;
    }
    const traditions = getSpellTraditions(spell);
    const best = getBestCastingEntry(record, traditions);
    if (!best) {
      api.sendMessage(getTrickMagicItemCard(record, item, spell, traditions.length ? traditions : Object.keys(TRADITION_SKILLS)));
      return;
    }
    const use = getItemSpellUseValues(item, itemPath, kind);
    if (Object.keys(use.values).length > 0) api.setValues(use.values);
    castItemSpellWith(
      record,
      item,
      spell,
      rank,
      {
        dc: parseInt(best.data?.dc, 10) || 0,
        mod: parseInt(best.data?.mod, 10) || 0,
        attribute: best.data?.attribute || "int",
        tradition: best.data?.tradition || capitalize(traditions[0] || "arcane"),
      },
      use.line,
    );
  });
  return true;
}

// The Trick Magic Item card's cast button: after a successful check, casts
// with Trick Magic Item's DC and attack and spends the item
function castItemSpellByTrick(recordId, itemId, traditions) {
  api.getRecord("characters", recordId, (record) => {
    const inventory = record?.data?.inventory || [];
    const itemIndex = inventory.findIndex((entry) => entry?._id === itemId);
    const item = inventory[itemIndex];
    if (!item) {
      api.showNotification("That item is no longer in the inventory.", "yellow", "Trick Magic Item");
      return;
    }
    const kind = getItemSpellKind(item);
    findItemSpell(getItemSpellRef(item), (spell) => {
      if (!spell) return;
      // The tradition skill the character is best at
      const tradition = (traditions || []).slice().sort(
        (a, b) =>
          (parseInt(record.data?.[TRADITION_SKILLS[b]] || "0", 10) || 0) -
          (parseInt(record.data?.[TRADITION_SKILLS[a]] || "0", 10) || 0),
      )[0] || "arcane";
      const casting = getTrickMagicItemCasting(record, TRADITION_SKILLS[tradition], tradition);
      const use = getItemSpellUseValues(item, `data.inventory.${itemIndex}`, kind);
      if (Object.keys(use.values).length > 0) api.setValuesOnRecord(record, use.values);
      castItemSpellWith(record, item, spell, getItemSpellRank(item), casting, ["*Trick Magic Item*", use.line].filter(Boolean).join("\n"));
    });
  });
}

// The values that bring wands' daily uses back (daily preparations)
function getWandRecharges(record) {
  const values = {};
  (record?.data?.inventory || []).forEach((item, index) => {
    if (getItemSpellKind(item) !== "wand") return;
    const max = parseInt(item?.data?.uses?.max, 10) || 0;
    if (max > 0 && (parseInt(item?.data?.uses?.value, 10) || 0) < max) {
      values[`data.inventory.${index}.data.uses.value`] = max;
    }
  });
  return values;
}
