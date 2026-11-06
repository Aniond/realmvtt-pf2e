// Reads an affliction out of a record's description, for the data script
// that writes data.affliction (roadmap B4, Sean's design on #64). Nothing
// here runs during play: the ruleset reads data.affliction only.
//
// The shapes the modules print:
//   - a paragraph per line: "Saving Throw" with its rollSavingThrow macro,
//     "Onset", "Maximum Duration", "Stage N" with damage and condition links
//     (GM Core, Player Core 2, Monster Core)
//   - one paragraph, the lines separated by "; <strong>…</strong>", the
//     macro's quotes as &#x27;, damage and conditions as plain text
//     (Treasure Vault)
//   - a spell: no Saving Throw line; the save is data.defense.save and the
//     DC the caster's ("spell")
//   - a save macro with no DC, rollSavingThrow('will'): the DC is left null
//     and reported
// parseRecordAffliction(record) -> { affliction, problems }. affliction is
// null when there's no stage, or no save to roll.

const UNITS = ["round", "minute", "hour", "day", "week"];

const TEXT_CONDITIONS = [
  "blinded", "clumsy", "confused", "dazzled", "deafened", "doomed", "drained",
  "enfeebled", "fascinated", "fatigued", "fleeing", "frightened", "immobilized",
  "off-guard", "paralyzed", "petrified", "prone", "sickened", "slowed",
  "stunned", "stupefied", "unconscious",
];

function decodeEntities(text) {
  return `${text || ""}`
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

// The record links in some HTML: { link, text }
function getLinks(html) {
  const links = [];
  const re = /<record-link\s+recordlink="([^"]*)"[^>]*>([\s\S]*?)<\/record-link>/g;
  let match;
  while ((match = re.exec(html))) {
    try {
      links.push({ link: JSON.parse(decodeEntities(match[1])), text: match[2] });
    } catch (e) {
      // Not JSON: only text
    }
  }
  return links;
}

function stripHtml(html) {
  return decodeEntities(`${html || ""}`.replace(/<record-link[^>]*>([\s\S]*?)<\/record-link>/g, "$1").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;)])/g, "$1")
    .trim();
}

// "1 round", "6 rounds", "10 minutes": { value, unit }; "1d6 hours":
// { dice, unit } for the GM to roll; or null ("varies"). The first time in
// the text.
function parseTime(text) {
  const lower = `${text || ""}`.toLowerCase();
  const dice = lower.match(/(\d+d\d+)\s*(round|minute|hour|day|week)s?\b/);
  const match = lower.match(/(^|[^d\d])(\d+)\s*(round|minute|hour|day|week)s?\b/);
  if (dice && (!match || dice.index <= match.index)) return { dice: dice[1], unit: dice[2] };
  return match ? { value: parseInt(match[2], 10), unit: match[3] } : null;
}

// "Clumsy 1" -> { name: "Clumsy", value: 1 }
function splitCondition(text) {
  const match = `${text || ""}`.trim().match(/^(.*?)\s+(\d+)$/);
  return match ? { name: match[1].trim(), value: parseInt(match[2], 10) } : { name: `${text || ""}`.trim(), value: 1 };
}

function capitalizeCondition(name) {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("-");
}

// The stage's interval: the last parentheses holding a time, and where they
// end (what follows is a note, as Curare's "If the victim fails...")
function getStageInterval(text) {
  const groups = [...`${text}`.matchAll(/\(([^()]*)\)/g)]
    .map((m) => ({ time: parseTime(m[1]), end: m.index + m[0].length }))
    .filter((g) => g.time);
  return groups.length ? groups[groups.length - 1] : null;
}

function parseStage(html) {
  const links = getLinks(html);
  const damage = [];
  const conditions = [];
  links.forEach(({ link }) => {
    const code = decodeEntities(link?.value?.code || "");
    const damageMatch = code.match(/executeDamageMacro\(\s*['"]([^'"]+)['"]/);
    if (damageMatch) damage.push(damageMatch[1]);
    if (link?.type === "effects" && link?.value?.name) conditions.push(splitCondition(link.value.name));
  });
  const full = stripHtml(html).replace(/^Stage \d+\s*/i, "").replace(/;\s*$/, "").trim();
  const found = getStageInterval(full);
  // The stage's own effects end at its interval
  const text = found ? full.slice(0, found.end).trim() : full;
  const note = found ? full.slice(found.end).replace(/^[.;\s]+/, "").trim() : "";
  if (!damage.length) {
    const re = /(\d+d\d+(?:\s*[+-]\s*\d+)?|\b\d+)\s+(persistent\s+)?([a-z]+)\s+damage/gi;
    let match;
    while ((match = re.exec(text))) damage.push(`${match[1].replace(/\s+/g, "")} ${match[2] ? "persistent " : ""}${match[3].toLowerCase()}`);
  }
  if (!conditions.length) {
    const lower = text.toLowerCase().replace(/flat-footed/g, "off-guard");
    TEXT_CONDITIONS.forEach((name) => {
      const match = lower.match(new RegExp(`\\b${name}(?:\\s+(\\d+))?\\b`));
      if (match) conditions.push({ name: capitalizeCondition(name), value: match[1] ? parseInt(match[1], 10) : 1 });
    });
  }
  return { text, ...(note ? { note } : {}), damage, conditions, interval: found ? found.time : null };
}

// The description cut into labelled pieces: at paragraph and line breaks,
// and before each <strong>Label</strong> that starts an affliction line
function getSegments(html) {
  return `${html || ""}`
    .split(/<\/p>|<br\s*\/?>|<hr\s*\/?>|\n|(?=<strong>\s*(?:Saving Throw|Onset|Maximum Duration|Stage \d+)\s*<\/strong>)/i)
    .map((piece) => piece.replace(/^\s*(?:<p[^>]*>)?\s*;?\s*/i, ""))
    .filter((piece) => piece.trim());
}

const SAVES = ["fortitude", "reflex", "will"];

function parseSaveSegment(segment) {
  const code = getLinks(segment).map(({ link }) => decodeEntities(link?.value?.code || "")).find((c) => /rollSavingThrow/.test(c)) || "";
  const fromCode = code.match(/rollSavingThrow\(\s*['"](\w+)['"]\s*(?:,\s*(\d+))?/);
  if (fromCode) return { save: fromCode[1].toLowerCase(), dc: fromCode[2] ? parseInt(fromCode[2], 10) : null };
  const text = stripHtml(segment);
  const save = SAVES.find((s) => new RegExp(`\\b${s}\\b`, "i").test(text)) || null;
  const dc = text.match(/DC\s*(\d+)/i);
  return { save, dc: dc ? parseInt(dc[1], 10) : null };
}

function parseRecordAffliction(record) {
  const data = record?.data || {};
  const html = data.description || "";
  const problems = [];
  // Some imports join the traits with hyphens ("Alchemical-…-Poison-Sleep")
  const traits = (data.traits || []).flatMap((t) => `${t}`.toLowerCase().split("-"));
  const affliction = {
    name: record?.name || "",
    kind: null,
    virulent: traits.includes("virulent"),
    level: parseInt(data.level, 10) || 0,
    save: null,
    dc: null,
    onset: null,
    maxDuration: null,
    stages: [],
  };
  const stageNumbers = [];
  getSegments(html).forEach((segment) => {
    const label = segment.match(/^<strong>\s*(Saving Throw|Onset|Maximum Duration|Stage (\d+))\s*<\/strong>/i);
    if (!label) {
      // The affliction's own line: "<strong>Goblin Pox</strong> (disease)
      // <strong>Level</strong> 1", or "<strong>Curse of Decadence</strong>
      // (curse)" before its Saving Throw
      const header = stripHtml(segment).match(/^(.+?)\s*\((curse|disease|poison)[^)]*\)(?:\s*Level\s+(\d+))?/i);
      if (header && !affliction.kind) {
        affliction.kind = header[2].toLowerCase();
        // A spell's affliction has its own name (Blood Chestnuts: Draining
        // Growth); the record's name stays without a header
        if (record?.recordType === "spells" && header[1].trim()) affliction.name = header[1].trim();
        if (header[3]) affliction.level = parseInt(header[3], 10);
      }
      return;
    }
    const name = label[1].toLowerCase();
    if (name === "saving throw") Object.assign(affliction, parseSaveSegment(segment));
    else if (name === "onset") affliction.onset = parseTime(stripHtml(segment).replace(/^Onset/i, ""));
    else if (name === "maximum duration") affliction.maxDuration = parseTime(stripHtml(segment).replace(/^Maximum Duration/i, ""));
    else {
      stageNumbers.push(parseInt(label[2], 10));
      affliction.stages.push(parseStage(segment));
    }
  });
  if (!affliction.stages.length) return { affliction: null, problems: ["no Stage lines"] };
  // A spell's save is its own; the DC is the caster's
  if (!affliction.save && record?.recordType === "spells") {
    affliction.save = `${data.defense?.save?.statistic || ""}`.toLowerCase() || null;
    affliction.dc = "spell";
  }
  if (!affliction.save) {
    problems.push("no save");
    return { affliction: null, problems };
  }
  if (affliction.dc === null) problems.push("no DC: the GM sets it");
  affliction.kind = affliction.kind || ["poison", "disease", "curse"].find((k) => traits.includes(k)) || null;
  if (!affliction.kind) problems.push("kind unknown (no poison, disease or curse trait)");
  stageNumbers.forEach((n, i) => {
    if (n !== i + 1) problems.push(`stage ${n} is line ${i + 1}`);
  });
  // "As stage 1, plus …": that stage's interval
  affliction.stages.forEach((stage) => {
    const as = stage.text.match(/^As stage (\d+)/i);
    const source = as && affliction.stages[parseInt(as[1], 10) - 1];
    if (!stage.interval && source?.interval) stage.interval = source.interval;
  });
  affliction.stages.forEach((stage, i) => {
    if (!stage.interval) problems.push(`stage ${i + 1}: no interval${i === affliction.stages.length - 1 ? " (a final stage?)" : ""}`);
  });
  return { affliction, problems };
}

// One line per affliction for the report
function describeTime(time) {
  if (!time) return "—";
  if (time.dice) return `${time.dice} ${time.unit}s`;
  return `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}`;
}

function describeAffliction(affliction) {
  const head = `${affliction.save} ${affliction.dc === "spell" ? "vs spell DC" : affliction.dc === null ? "(no DC)" : `DC ${affliction.dc}`}; ${affliction.kind || "kind?"}${affliction.virulent ? ", virulent" : ""}; onset ${describeTime(affliction.onset)}; max ${describeTime(affliction.maxDuration)}; ${affliction.stages.length} stage${affliction.stages.length === 1 ? "" : "s"}`;
  const stages = affliction.stages.map((stage, i) => {
    const conditions = stage.conditions.map((c) => `${c.name} ${c.value}`).join(", ");
    return `  ${i + 1}. ${stage.damage.join(" + ") || "no damage"}; ${conditions || "no conditions"}; ${describeTime(stage.interval)}`;
  });
  return [head, ...stages].join("\n");
}

// The effect's name: the affliction's, without a monster ability's
// "(Graveknight) " prefix
function getAfflictionEffectName(name) {
  return `${name || ""}`.replace(/^\([^)]*\)\s*/, "").trim();
}

// The afflictions a record carries: its own description (an item, a spell,
// an ability record), or for an NPC each ability in data.actions. Each is
// { index, name, affliction, problems }, index null for the record itself.
function getRecordAfflictions(record) {
  const stage = /Stage\s*1\b/;
  if (record?.recordType === "npcs") {
    return (record.data?.actions || [])
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => stage.test(action?.data?.description || ""))
      .map(({ action, index }) => ({ index, name: action.name, ...parseRecordAffliction({ ...action, recordType: "actions" }) }));
  }
  if (!stage.test(record?.data?.description || "")) return [];
  return [{ index: null, name: record.name, ...parseRecordAffliction(record) }];
}

// Whether an affliction can be written: it needs a save and a DC (or the
// caster's). One without a DC is reported for fixing by hand.
function isWritableAffliction(found) {
  return !!found.affliction && found.affliction.dc !== null;
}

// The record's data with data.affliction set (an NPC's on the ability), or
// null when it already matches. effectIds: affliction name -> effect id.
function getAfflictionData(record, found, effectIds) {
  const data = record.data || {};
  const stored = (affliction) => ({ ...affliction, effectId: effectIds[getAfflictionEffectName(affliction.name)] || null });
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const writable = found.filter(isWritableAffliction);
  if (record.recordType === "npcs") {
    let changed = false;
    const actions = (data.actions || []).map((action, index) => {
      const match = writable.find((f) => f.index === index);
      if (!match) return action;
      const affliction = stored(match.affliction);
      if (same(action.data?.affliction, affliction)) return action;
      changed = true;
      return { ...action, data: { ...action.data, affliction } };
    });
    return changed ? { ...data, actions } : null;
  }
  if (!writable.length) return null;
  const affliction = stored(writable[0].affliction);
  return same(data.affliction, affliction) ? null : { ...data, affliction };
}

// The effect the script creates for an affliction: stackable, the stacks are
// the stage (as Monster Core's Bogwid Fever). Its duration is set when it's
// applied (the maximum duration), so the record's is indefinite.
// The affliction's own lines from the delivering record's description, each
// as a paragraph with its links (the save, damage and conditions stay
// clickable): the header of a spell's or curse's affliction, Saving Throw,
// Onset, Maximum Duration and the stages, then a line saying the stacks are
// the stage. Copied, never changed; "" when there are none.
function getAfflictionEffectDescription(html, affliction) {
  const lines = getSegments(html)
    .filter((segment) =>
      /^<strong>\s*(?:Saving Throw|Onset|Maximum Duration|Stage \d+)\s*<\/strong>/i.test(segment) ||
      /^.+?\s*\((?:curse|disease|poison)[^)]*\)/i.test(stripHtml(segment)))
    .map((segment) => `<p>${segment.trim().replace(/;\s*$/, "")}</p>`);
  if (!lines.length) return "";
  const count = affliction?.stages?.length || 0;
  return `${lines.join("")}<p><em>The stacks are the stage${count ? ` (${count} stage${count === 1 ? "" : "s"})` : ""}.</em></p>`;
}

// The placeholder description the first runs wrote ("Poison: the stacks
// are the stage (3 stages)."), the only description a rerun replaces
const PLACEHOLDER_EFFECT_DESCRIPTION = /^<p>\w+: the stacks are the stage \(\d+ stages?\)\.<\/p>$/;

// category: the delivering record's, so the effect files with its book.
// description: getAfflictionEffectDescription of the delivering record.
function getAfflictionEffect(affliction, { campaignId, portrait = "", category = "", description = "" } = {}) {
  const kind = affliction.kind || "affliction";
  return {
    campaignId,
    name: getAfflictionEffectName(affliction.name),
    description: description || `<p>${kind.charAt(0).toUpperCase()}${kind.slice(1)}: the stacks are the stage (${affliction.stages.length} stage${affliction.stages.length === 1 ? "" : "s"}).</p>`,
    portrait,
    ...(category ? { category } : {}),
    stackable: true,
    allowsMultiple: false,
    tokenMenu: false,
    duration: 0,
    durationUnit: "indefinite",
    rules: [],
  };
}

module.exports = {
  parseRecordAffliction,
  describeAffliction,
  parseTime,
  decodeEntities,
  getSegments,
  getRecordAfflictions,
  isWritableAffliction,
  getAfflictionData,
  getAfflictionEffect,
  getAfflictionEffectDescription,
  getAfflictionEffectName,
  PLACEHOLDER_EFFECT_DESCRIPTION,
  UNITS,
};
