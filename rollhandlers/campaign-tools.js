// Campaign tools (roadmap B16, B3, B7): treasure by level and faction
// reputation on the GM Tools panel (gm-tools-panel.html), downtime days on
// the character's Skills tab, connections on the Notes tab.
//
//   - Treasure (GM Core pg. 58, Table 10-9): the party's budget for its
//     level and size, what's been awarded against it, and the items it
//     suggests. With Automatic Bonus Progression, a note to leave out
//     fundamental runes
//   - Reputation (GM Core pg. 201): a faction's points (-50 to 50) and tier,
//     changed by favors and disservices
//   - Downtime (Player Core pg. 437): days available, spent with a log line;
//     the GM grants days to the party
//   - Connections (NPC Core pg. 226): an NPC and the tier of the bond, kept
//     by hand
//
// The panel's values are campaign variables, as the encounter builder's: each
// action writes only what it changed and its meter, the one object the
// panel's labels read.

// ---------------------------------------------------------------- Treasure

// Party Treasure by Level (GM Core Table 10-9), for four characters: the
// total, the permanent items and consumables by item level ([level, count]),
// the currency, and the currency for each character past four
const PARTY_TREASURE = {
  1: { total: 175, permanent: [[2, 2], [1, 2]], consumables: [[2, 2], [1, 3]], currency: 40, perPc: 10 },
  2: { total: 300, permanent: [[3, 2], [2, 2]], consumables: [[3, 2], [2, 2], [1, 2]], currency: 70, perPc: 18 },
  3: { total: 500, permanent: [[4, 2], [3, 2]], consumables: [[4, 2], [3, 2], [2, 2]], currency: 120, perPc: 30 },
  4: { total: 850, permanent: [[5, 2], [4, 2]], consumables: [[5, 2], [4, 2], [3, 2]], currency: 200, perPc: 50 },
  5: { total: 1350, permanent: [[6, 2], [5, 2]], consumables: [[6, 2], [5, 2], [4, 2]], currency: 320, perPc: 80 },
  6: { total: 2000, permanent: [[7, 2], [6, 2]], consumables: [[7, 2], [6, 2], [5, 2]], currency: 500, perPc: 125 },
  7: { total: 2900, permanent: [[8, 2], [7, 2]], consumables: [[8, 2], [7, 2], [6, 2]], currency: 720, perPc: 180 },
  8: { total: 4000, permanent: [[9, 2], [8, 2]], consumables: [[9, 2], [8, 2], [7, 2]], currency: 1000, perPc: 250 },
  9: { total: 5700, permanent: [[10, 2], [9, 2]], consumables: [[10, 2], [9, 2], [8, 2]], currency: 1400, perPc: 350 },
  10: { total: 8000, permanent: [[11, 2], [10, 2]], consumables: [[11, 2], [10, 2], [9, 2]], currency: 2000, perPc: 500 },
  11: { total: 11500, permanent: [[12, 2], [11, 2]], consumables: [[12, 2], [11, 2], [10, 2]], currency: 2800, perPc: 700 },
  12: { total: 16500, permanent: [[13, 2], [12, 2]], consumables: [[13, 2], [12, 2], [11, 2]], currency: 4000, perPc: 1000 },
  13: { total: 25000, permanent: [[14, 2], [13, 2]], consumables: [[14, 2], [13, 2], [12, 2]], currency: 6000, perPc: 1500 },
  14: { total: 36500, permanent: [[15, 2], [14, 2]], consumables: [[15, 2], [14, 2], [13, 2]], currency: 9000, perPc: 2250 },
  15: { total: 54500, permanent: [[16, 2], [15, 2]], consumables: [[16, 2], [15, 2], [14, 2]], currency: 13000, perPc: 3250 },
  16: { total: 82500, permanent: [[17, 2], [16, 2]], consumables: [[17, 2], [16, 2], [15, 2]], currency: 20000, perPc: 5000 },
  17: { total: 128000, permanent: [[18, 2], [17, 2]], consumables: [[18, 2], [17, 2], [16, 2]], currency: 30000, perPc: 7500 },
  18: { total: 208000, permanent: [[19, 2], [18, 2]], consumables: [[19, 2], [18, 2], [17, 2]], currency: 48000, perPc: 12000 },
  19: { total: 355000, permanent: [[20, 2], [19, 2]], consumables: [[20, 2], [19, 2], [18, 2]], currency: 80000, perPc: 20000 },
  20: { total: 490000, permanent: [[20, 4]], consumables: [[20, 4], [19, 2]], currency: 140000, perPc: 35000 },
};

const TREASURE_VARS = {
  awarded: "treasureAwarded",
  meter: "treasureMeter",
};

// The level's budget for the party's size: the total, with the currency per
// character past four added (or taken away for fewer, GM Core pg. 59)
function getTreasureBudget(level, size = 4) {
  const row = PARTY_TREASURE[Math.min(20, Math.max(1, parseInt(level, 10) || 1))];
  const extra = (parseInt(size, 10) || 4) - 4;
  return {
    ...row,
    total: Math.max(0, row.total + extra * row.perPc),
    currency: Math.max(0, row.currency + extra * row.perPc),
  };
}

// "2 × 4th, 2 × 3rd" (getOrdinal, spell-entries.js)
function describeTreasureItems(items) {
  return items.map(([level, count]) => `${count} × ${getOrdinal(level)}`).join(", ");
}

// The panel's treasure meter: awarded against the budget, and the budget's
// parts
function getTreasureMeter({ level, size, awarded }, variants = getVariantRules()) {
  const budget = getTreasureBudget(level, size);
  // formatGp: character-growth.js
  const given = Math.max(0, Math.round((parseFloat(awarded) || 0) * 100) / 100);
  const left = budget.total - given;
  return {
    awarded: given,
    max: budget.total,
    awardedLabel: `${formatGp(given)} awarded`,
    budgetLabel: `of ${formatGp(budget.total)} for level ${level}, ${size} PCs`,
    left: left >= 0 ? `${formatGp(left)} left` : `${formatGp(-left)} over`,
    permanent: `Permanent items: ${describeTreasureItems(budget.permanent)}`,
    consumables: `Consumables: ${describeTreasureItems(budget.consumables)}`,
    currency: `Currency: ${formatGp(budget.currency)}`,
    abp: variants.automaticBonusProgression ? "Automatic Bonus Progression: leave out potency, striking and resilient runes." : "",
  };
}

function getTreasureState() {
  const read = (name) => api.getCampaignVariable?.(name);
  return {
    level: parseInt(read(ENCOUNTER_BUILDER_VARS.level), 10) || 1,
    size: parseInt(read(ENCOUNTER_BUILDER_VARS.size), 10) || 4,
    awarded: parseFloat(read(TREASURE_VARS.awarded)) || 0,
  };
}

function writeTreasureMeter(state) {
  api.setCampaignVariable(TREASURE_VARS.meter, getTreasureMeter(state));
}

// "120", "3 gp 5 sp", "50 sp": the value in gp, or null
function parseGpValue(text) {
  const value = `${text || ""}`.trim().toLowerCase();
  if (!value) return null;
  const coins = { pp: 10, gp: 1, sp: 0.1, cp: 0.01 };
  const parts = [...value.matchAll(/(-?\d+(?:\.\d+)?)\s*(pp|gp|sp|cp)?/g)];
  if (!parts.length) return null;
  return parts.reduce((sum, [, number, coin]) => sum + parseFloat(number) * coins[coin || "gp"], 0);
}

// Add Award: coin or an item's Price, added to the level's tally (negative
// to take back a mistake)
function addTreasureAward() {
  api.showValuePrompt("Treasure", "Value awarded (120, 3 gp 5 sp, or -20 to take back)", (value) => {
    const gp = parseGpValue(value);
    if (gp === null) return;
    const state = getTreasureState();
    const awarded = Math.max(0, Math.round((state.awarded + gp) * 100) / 100);
    api.setCampaignVariable(TREASURE_VARS.awarded, awarded);
    writeTreasureMeter({ ...state, awarded });
  });
}

// New Level: posts the last level's tally for the GM and starts again at 0
function startTreasureLevel() {
  const state = getTreasureState();
  const budget = getTreasureBudget(state.level, state.size);
  api.sendMessage(`[gm]**Treasure:** ${formatGp(state.awarded)} of ${formatGp(budget.total)} awarded at level ${state.level}.[/gm]`);
  api.setCampaignVariable(TREASURE_VARS.awarded, 0);
  writeTreasureMeter({ ...state, awarded: 0 });
}

// The party's level or size changed (the encounter builder's fields, shared)
function refreshTreasureMeter(overrides = {}) {
  writeTreasureMeter({ ...getTreasureState(), ...overrides });
}

// ---------------------------------------------------------------- Reputation

// Reputation tiers (GM Core pg. 201): the lowest points of each
const REPUTATION_TIERS = [
  { name: "Revered", min: 30 },
  { name: "Admired", min: 15 },
  { name: "Liked", min: 5 },
  { name: "Ignored", min: -4 },
  { name: "Disliked", min: -14 },
  { name: "Hated", min: -29 },
  { name: "Hunted", min: -50 },
];

const REPUTATION_CHANGES = [
  { label: "Minor favor (+1)", value: 1 },
  { label: "Moderate favor (+2)", value: 2 },
  { label: "Major favor (+5)", value: 5 },
  { label: "Minor disservice (-1)", value: -1 },
  { label: "Moderate disservice (-2)", value: -2 },
  { label: "Major disservice (-5)", value: -5 },
];

const REPUTATION_VARS = {
  factions: "reputationFactions",
  meter: "reputationMeter",
};

// The panel's faction rows
const REPUTATION_METER_ROWS = 8;

function getReputationTier(points) {
  const value = parseInt(points, 10) || 0;
  return (REPUTATION_TIERS.find((tier) => value >= tier.min) || REPUTATION_TIERS[REPUTATION_TIERS.length - 1]).name;
}

// Points stay within -50 and 50
function clampReputation(points) {
  return Math.max(-50, Math.min(50, parseInt(points, 10) || 0));
}

function getReputationMeter(factions) {
  const rows = (factions || []).slice(0, REPUTATION_METER_ROWS).map((faction) => ({
    name: faction.name,
    standing: `${faction.points >= 0 ? "+" : ""}${faction.points} ${getReputationTier(faction.points)}`,
  }));
  if ((factions || []).length > REPUTATION_METER_ROWS) {
    rows[REPUTATION_METER_ROWS - 1] = { name: `+${factions.length - REPUTATION_METER_ROWS + 1} more`, standing: "" };
  }
  return { rows, empty: rows.length ? "" : "No factions yet" };
}

function getReputationFactions() {
  const factions = api.getCampaignVariable?.(REPUTATION_VARS.factions);
  return Array.isArray(factions) ? factions : [];
}

function writeReputation(factions) {
  api.setCampaignVariable(REPUTATION_VARS.factions, factions);
  api.setCampaignVariable(REPUTATION_VARS.meter, getReputationMeter(factions));
}

function getFactionOptions(factions) {
  return factions.map((faction, index) => ({
    label: `${faction.name} (${faction.points >= 0 ? "+" : ""}${faction.points}, ${getReputationTier(faction.points)})`,
    value: String(index),
  }));
}

// Add Faction: starts Ignored at 0
function addReputationFaction() {
  api.showValuePrompt("Reputation", "Faction name", (value) => {
    const name = `${value || ""}`.trim();
    if (!name) return;
    writeReputation([...getReputationFactions(), { name, points: 0 }]);
  });
}

// The faction after a favor or disservice, and the chat line
function getReputationChange(faction, change) {
  const points = clampReputation(faction.points + change);
  const before = getReputationTier(faction.points);
  const after = getReputationTier(points);
  const tier = before === after ? after : `${before} to ${after}`;
  return {
    faction: { ...faction, points },
    message: `**Reputation:** ${faction.name} ${change > 0 ? "+" : ""}${change}, now ${points >= 0 ? "+" : ""}${points} (${tier}).`,
  };
}

// Favor or Disservice: pick the faction, then how big
function changeReputation() {
  const factions = getReputationFactions();
  if (!factions.length) {
    api.showNotification("Add a faction first.", "yellow", "Reputation");
    return;
  }
  const pick = (choice) => (Array.isArray(choice) ? choice[0] : choice);
  api.showPrompt("Reputation", "Which faction?", "Select...", getFactionOptions(factions), null, (factionChoice) => {
    const index = parseInt(pick(factionChoice), 10);
    if (!Number.isFinite(index)) return;
    api.showPrompt(
      "Reputation",
      "A favor or a disservice?",
      "Select...",
      REPUTATION_CHANGES.map(({ label, value }) => ({ label, value: String(value) })),
      null,
      (changeChoice) => {
        const change = parseInt(pick(changeChoice), 10);
        const latest = getReputationFactions();
        if (!change || !latest[index]) return;
        const { faction, message } = getReputationChange(latest[index], change);
        writeReputation(latest.map((f, i) => (i === index ? faction : f)));
        api.sendMessage(message);
      },
      "OK",
      "Cancel",
      1,
    );
  }, "OK", "Cancel", 1);
}

function removeReputationFaction() {
  const factions = getReputationFactions();
  if (!factions.length) return;
  api.showPrompt("Reputation", "Remove which faction?", "Select...", getFactionOptions(factions), null, (choice) => {
    const index = parseInt(Array.isArray(choice) ? choice[0] : choice, 10);
    const latest = getReputationFactions();
    if (!latest[index]) return;
    writeReputation(latest.filter((_, i) => i !== index));
  }, "Remove", "Cancel", 1);
}

// ---------------------------------------------------------------- Downtime

const DOWNTIME_ACTIVITIES = [
  "Earn Income", "Craft", "Retrain", "Long-Term Rest", "Subsist",
  "Create Forgery", "Treat Disease", "Learn a Spell", "Other",
];

// A log line, newest first, as a paragraph of the log's rich text
function getDowntimeLogValue(log, line) {
  return `<p>${line}</p>${log || ""}`;
}

// The write for spending days on an activity: fewer days and a log line.
// More days than are left is the GM's call: it goes below 0 and says so.
function getSpendDowntimeValues(record, days, activity) {
  const have = parseInt(record?.data?.downtimeDays, 10) || 0;
  const left = have - days;
  return {
    values: {
      "data.downtimeDays": left,
      "data.downtimeLog": getDowntimeLogValue(record?.data?.downtimeLog, `${activity}: ${days} day${days === 1 ? "" : "s"}${left < 0 ? ` (${-left} more than available)` : ""}`),
    },
    over: left < 0,
  };
}

// The Skills tab's Spend Days button: how many, then on what
function spendDowntimeDays(record) {
  api.showValuePrompt("Downtime", "Days spent", (value) => {
    const days = parseInt(value, 10);
    if (!(days > 0)) return;
    api.showPrompt(
      "Downtime",
      `${days} day${days === 1 ? "" : "s"} on what?`,
      "Select...",
      DOWNTIME_ACTIVITIES.map((name) => ({ label: name, value: name })),
      null,
      (choice) => {
        const activity = (Array.isArray(choice) ? choice[0] : choice) || "Other";
        api.getRecord("characters", record._id, (latest) => {
          const { values, over } = getSpendDowntimeValues(latest || record, days, activity);
          api.setValuesOnRecord(latest || record, values);
          if (over) api.showNotification("More days than the character has; the GM may allow it.", "yellow", "Downtime");
        });
      },
      "OK",
      "Cancel",
      1,
    );
  });
}

function getGrantDowntimeValues(record, days) {
  return {
    "data.downtimeDays": (parseInt(record?.data?.downtimeDays, 10) || 0) + days,
    "data.downtimeLog": getDowntimeLogValue(record?.data?.downtimeLog, `Granted ${days} day${days === 1 ? "" : "s"}`),
  };
}

// The GM Tools panel's Grant Downtime: days to each Party Sheet character
function grantDowntimeDays() {
  api.showValuePrompt("Downtime", "Days of downtime for the party", (value) => {
    const days = parseInt(value, 10);
    if (!(days > 0)) return;
    api.getParty((party) => {
      const members = (party || []).filter((member) => member?.recordType === "characters");
      if (!members.length) {
        api.showNotification("Open the Party Sheet from the View menu and drag the characters onto it.", "yellow", "Downtime");
        return;
      }
      members.forEach((member) => api.setValuesOnRecord(member, getGrantDowntimeValues(member, days)));
      api.sendMessage(`**Downtime:** ${members.map((member) => getCreatureName(member)).join(", ")} each have ${days} more day${days === 1 ? "" : "s"}.`);
    });
  });
}
