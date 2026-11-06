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

// "1 round", "6 rounds", "10 minutes": { value, unit }, or null (dice,
// "varies"). The first time in the text.
function parseTime(text) {
  const match = `${text || ""}`.toLowerCase().match(/(^|[^d\d])(\d+)\s*(round|minute|hour|day|week)s?\b/);
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
  const traits = (data.traits || []).map((t) => `${t}`.toLowerCase());
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
      // A spell's affliction line: "<strong>Goblin Pox</strong> (disease) <strong>Level</strong> 1"
      const header = stripHtml(segment).match(/^(.+?)\s*\((curse|disease|poison)[^)]*\)\s*Level\s+(\d+)/i);
      if (header && !affliction.kind) {
        affliction.kind = header[2].toLowerCase();
        affliction.level = parseInt(header[3], 10);
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
  affliction.stages.forEach((stage, i) => {
    if (!stage.interval) problems.push(`stage ${i + 1}: no interval${i === affliction.stages.length - 1 ? " (a final stage?)" : ""}`);
  });
  return { affliction, problems };
}

// One line per affliction for the report
function describeTime(time) {
  return time ? `${time.value} ${time.unit}${time.value === 1 ? "" : "s"}` : "—";
}

function describeAffliction(affliction) {
  const head = `${affliction.save} ${affliction.dc === "spell" ? "vs spell DC" : affliction.dc === null ? "(no DC)" : `DC ${affliction.dc}`}; ${affliction.kind || "kind?"}${affliction.virulent ? ", virulent" : ""}; onset ${describeTime(affliction.onset)}; max ${describeTime(affliction.maxDuration)}; ${affliction.stages.length} stages`;
  const stages = affliction.stages.map((stage, i) => {
    const conditions = stage.conditions.map((c) => `${c.name} ${c.value}`).join(", ");
    return `  ${i + 1}. ${stage.damage.join(" + ") || "no damage"}; ${conditions || "no conditions"}; ${describeTime(stage.interval)}`;
  });
  return [head, ...stages].join("\n");
}

module.exports = { parseRecordAffliction, describeAffliction, parseTime, decodeEntities, getSegments, UNITS };
