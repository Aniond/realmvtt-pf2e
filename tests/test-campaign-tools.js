// Tests for the campaign tools (campaign-tools.js, roadmap B16, B3, B7):
// treasure by level, faction reputation, downtime days.

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;
let vars = {};
ctx.api.getCampaignVariable = (name) => vars[name];
ctx.api.setCampaignVariable = (name, value) => {
  vars[name] = value;
};
let valuePrompt = null;
ctx.api.showValuePrompt = (title, text, cb) => {
  valuePrompt = cb;
};
let prompts = [];
ctx.api.showPrompt = (...args) => prompts.push(args);

section("Treasure: the budget by level and party size");
{
  const level3 = ctx.getTreasureBudget(3, 4);
  assert("level 3, four PCs: 500 gp", level3.total, 500);
  assert("its currency", level3.currency, 120);
  assert("five PCs: +30 gp", ctx.getTreasureBudget(3, 5).total, 530);
  assert("three PCs: -30 gp", [ctx.getTreasureBudget(3, 3).total, ctx.getTreasureBudget(3, 3).currency], [470, 90]);
  assert("level 20", ctx.getTreasureBudget(20, 4).total, 490000);
  assert("past 20: 20's row", ctx.getTreasureBudget(25, 4).total, 490000);
  assert("below 1: 1's row", ctx.getTreasureBudget(0, 4).total, 175);
}

section("Treasure: the meter");
{
  settings = {};
  const meter = ctx.getTreasureMeter({ level: 3, size: 4, awarded: 420 });
  assert("awarded", [meter.awarded, meter.awardedLabel], [420, "420 gp awarded"]);
  assert("the budget", [meter.max, meter.budgetLabel], [500, "of 500 gp for level 3, 4 PCs"]);
  assert("what's left", meter.left, "80 gp left");
  assert("the items", meter.permanent, "Permanent items: 2 × 4th, 2 × 3rd");
  assert("consumables", meter.consumables, "Consumables: 2 × 4th, 2 × 3rd, 2 × 2nd");
  assert("no ABP note", meter.abp, "");
  assert("over the budget", ctx.getTreasureMeter({ level: 1, size: 4, awarded: 200 }).left, "25 gp over");
  settings = { automaticBonusProgression: "yes" };
  assertIncludes("ABP: leave out fundamental runes", ctx.getTreasureMeter({ level: 3, size: 4, awarded: 0 }).abp, "potency, striking and resilient");
  settings = {};
  assert("thousands", ctx.getTreasureMeter({ level: 12, size: 4, awarded: 1500 }).budgetLabel, "of 16,500 gp for level 12, 4 PCs");
  assert("ordinals", [1, 2, 3, 11, 12, 13, 21].map((n) => ctx.getOrdinal(n)), ["1st", "2nd", "3rd", "11th", "12th", "13th", "21st"]);
}

section("Treasure: awards");
{
  assert("plain gp", ctx.parseGpValue("120"), 120);
  assert("coins", Math.round(ctx.parseGpValue("3 gp 5 sp") * 100) / 100, 3.5);
  assert("platinum", ctx.parseGpValue("2 pp"), 20);
  assert("taking back", ctx.parseGpValue("-20"), -20);
  assert("nothing", ctx.parseGpValue("lots"), null);

  vars = { encounterPartyLevel: 3, encounterPartySize: 4, treasureAwarded: 100 };
  ctx.addTreasureAward();
  valuePrompt("3 gp 5 sp");
  assert("added to the tally", vars.treasureAwarded, 103.5);
  assert("the meter written", vars.treasureMeter.awardedLabel, "103.5 gp awarded");
  ctx.addTreasureAward();
  valuePrompt("-500");
  assert("never below 0", vars.treasureAwarded, 0);

  vars.treasureAwarded = 480;
  ctx.__state.messages.length = 0;
  ctx.startTreasureLevel();
  assertIncludes("New Level posts the tally for the GM", ctx.__state.messages[0], "[gm]**Treasure:** 480 gp of 500 gp awarded at level 3.[/gm]");
  assert("... and starts again", [vars.treasureAwarded, vars.treasureMeter.awarded], [0, 0]);

  ctx.refreshTreasureMeter({ level: 5 });
  assert("a new party level: the meter follows", vars.treasureMeter.max, 1350);
}

section("Treasure: Use the Party updates it too");
{
  vars = {};
  ctx.api.getParty = (cb) => cb([
    { recordType: "characters", data: { level: 4 } },
    { recordType: "characters", data: { level: 4 } },
    { recordType: "characters", data: { level: 4 } },
  ]);
  ctx.setEncounterBuilderFromParty();
  assert("the encounter builder's party", [vars.encounterPartyLevel, vars.encounterPartySize], [4, 3]);
  assert("the treasure budget for it", vars.treasureMeter.max, 800);
}

section("Reputation: tiers");
{
  const tier = (p) => ctx.getReputationTier(p);
  assert("the tiers' edges", [50, 30, 29, 15, 14, 5, 4, 0, -4, -5, -14, -15, -29, -30, -50].map(tier), [
    "Revered", "Revered", "Admired", "Admired", "Liked", "Liked", "Ignored", "Ignored", "Ignored",
    "Disliked", "Disliked", "Hated", "Hated", "Hunted", "Hunted",
  ]);
  assert("kept within -50 and 50", [ctx.clampReputation(55), ctx.clampReputation(-60)], [50, -50]);
}

section("Reputation: favors and disservices");
{
  const change = ctx.getReputationChange({ name: "Pathfinder Society", points: 3 }, 2);
  assert("the points", change.faction.points, 5);
  assertIncludes("the tier change", change.message, "Pathfinder Society +2, now +5 (Ignored to Liked).");
  const same = ctx.getReputationChange({ name: "Aspis", points: -6 }, -1);
  assertIncludes("same tier", same.message, "Aspis -1, now -7 (Disliked).");

  vars = {};
  ctx.addReputationFaction();
  valuePrompt("Pathfinder Society");
  assert("a new faction at 0", vars.reputationFactions, [{ name: "Pathfinder Society", points: 0 }]);
  assert("its row", vars.reputationMeter.rows[0], { name: "Pathfinder Society", standing: "+0 Ignored" });

  prompts = [];
  ctx.__state.messages.length = 0;
  ctx.changeReputation();
  prompts[0][5]("0");
  prompts[1][5]("5");
  assert("a major favor", vars.reputationFactions[0].points, 5);
  assertIncludes("posted", ctx.__state.messages[0], "now +5 (Ignored to Liked)");

  prompts = [];
  ctx.removeReputationFaction();
  prompts[0][5]("0");
  assert("removed", [vars.reputationFactions, vars.reputationMeter.empty], [[], "No factions yet"]);

  const many = Array.from({ length: 10 }, (_, i) => ({ name: `F${i}`, points: 0 }));
  const meter = ctx.getReputationMeter(many);
  assert("past 8 rows: the last says how many more", [meter.rows.length, meter.rows[7].name], [8, "+3 more"]);
}

section("Downtime: spending and granting days");
{
  const spent = ctx.getSpendDowntimeValues({ data: { downtimeDays: 10, downtimeLog: "<p>Granted 10 days</p>" } }, 7, "Retrain");
  assert("fewer days", spent.values["data.downtimeDays"], 3);
  assert("a log line, newest first", spent.values["data.downtimeLog"], "<p>Retrain: 7 days</p><p>Granted 10 days</p>");
  const over = ctx.getSpendDowntimeValues({ data: { downtimeDays: 2 } }, 5, "Craft");
  assert("more than available: allowed, noted", [over.over, over.values["data.downtimeDays"], over.values["data.downtimeLog"]], [true, -3, "<p>Craft: 5 days (3 more than available)</p>"]);
  const granted = ctx.getGrantDowntimeValues({ data: { downtimeDays: 3 } }, 1);
  assert("granting", granted, { "data.downtimeDays": 4, "data.downtimeLog": "<p>Granted 1 day</p>" });

  const writes = [];
  ctx.api.setValuesOnRecord = (record, values) => writes.push([record.name, values]);
  ctx.api.getParty = (cb) => cb([
    { name: "Amiri", recordType: "characters", data: { downtimeDays: 0 } },
    { name: "Ezren", recordType: "characters", data: { downtimeDays: 2 } },
    { name: "Wolf", recordType: "npcs", data: {} },
  ]);
  ctx.__state.messages.length = 0;
  ctx.grantDowntimeDays();
  valuePrompt("7");
  assert("each character, one write", writes.map(([name, v]) => [name, v["data.downtimeDays"]]), [["Amiri", 7], ["Ezren", 9]]);
  assertIncludes("posted", ctx.__state.messages[0], "Amiri, Ezren each have 7 more days.");

  writes.length = 0;
  prompts = [];
  ctx.api.getRecord = (type, id, cb) => cb({ _id: id, name: "Amiri", data: { downtimeDays: 7 } });
  ctx.spendDowntimeDays({ _id: "amiri" });
  valuePrompt("3");
  prompts[0][5]("Earn Income");
  assert("Spend Days: from a fresh read", writes[0][1]["data.downtimeDays"], 4);
}

summary();
