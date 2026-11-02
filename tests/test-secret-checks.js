// Tests for secret checks (check-tools.js, rollSkill, skill.js).
// Run: node tests/test-secret-checks.js   (or via tests/run-all.js)

const fs = require("fs");
const vm = require("vm");
const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

let settings = {};
ctx.api.getSetting = (key) => settings[key] ?? null;

const sent = [];
function runHandler(file, data) {
  sent.length = 0;
  ctx.api.sendMessage = (...args) => sent.push(args);
  ctx.data = data;
  const code = fs.readFileSync(`${__dirname}/../rollhandlers/${file}`, "utf8");
  new vm.Script(`(function () {\n${code}\n})();`, { filename: file }).runInContext(ctx);
  return sent[0] || [];
}

section("Which checks are secret");
{
  settings = {};
  assert("off by default: nothing is secret", ctx.isSecretCheck("Recall Knowledge"), false);
  settings = { secretChecks: "yes" };
  assert(
    "on: the secret trait's actions",
    ["Recall Knowledge", "Seek", "Sense Motive", "Hide", "Sneak", "Lie", "identify magic", "Identify Alchemy", "Decipher Writing"].map((a) => ctx.isSecretCheck(a)),
    [true, true, true, true, true, true, true, true, true],
  );
  assert("... not the others", ["Climb", "Demoralize", "Avoid Notice", "Search", "", undefined].map((a) => ctx.isSecretCheck(a)), [false, false, false, false, false, false]);
}

section("The roll: GM-only");
{
  settings = { secretChecks: "yes" };
  let rolled = null;
  ctx.api.promptRollForToken = (who, name, formula, modifiers, metadata) => (rolled = metadata);
  ctx.api.getTargets = () => [];
  const ezren = { _id: "ezren", recordId: "ezren-rec", recordType: "characters", name: "Ezren", data: { society: 7 } };
  ctx.performSkillAction(ezren, "society", "Recall Knowledge", true);
  assert("a secret action: flagged, and the prompt forced private", [rolled?.secret, rolled?.forcedAudience], [true, "private"]);
  ctx.performSkillAction(ezren, "society", "Create Forgery", true);
  assert("... another", rolled?.forcedAudience, "private");
  rolled = null;
  ctx.performSkillAction(ezren, "athletics", "Climb", true);
  assert("not a secret action: as before", [rolled?.rollName, rolled?.secret, rolled?.forcedAudience], ["Athletics: Climb", undefined, undefined]);
  settings = {};
  rolled = null;
  ctx.performSkillAction(ezren, "society", "Recall Knowledge", true);
  assert("setting off: as before", [rolled?.secret, rolled?.forcedAudience], [undefined, undefined]);
  assert("Assurance keeps the flag", ctx.getAssuranceMetadata({ secret: true, rollName: "Society" }, 17).secret, true);
}

section("The card");
{
  const roll = (metadata, total = 19, d20 = 12) => ({ roll: { dice: [{ type: 20, value: d20 }], total, metadata } });
  const [message, attached, , tags] = runHandler(
    "skill.js",
    roll({ dc: 15, rollName: "Religion: Recall Knowledge", secret: true, gmNote: "Skills: Religion (undead).", gmMacro: "```Identify_Item\nx\n```" }),
  );
  assert("no dice attached", attached, undefined);
  assert("the tags stay", tags?.[0]?.name, "Religion: Recall Knowledge");
  const lines = message.split("\n");
  assert("the table's line: only that it was made", lines[0], "**Religion: Recall Knowledge** (secret check)");
  assertIncludes("the GM: the total and the d20", message, "[gm]Secret check: 19 (d20: 12)[/gm]");
  assertIncludes("... the degree", message, "SUCCESS");
  assertIncludes("... the note", message, "[gm]Skills: Religion (undead).[/gm]");
  const text = lines.slice(1, lines.findIndex((line) => line.startsWith("```")));
  assert("every other line hidden, with no nested [gm] tags", text.every((line) => /^\[gm\][^\[]*(\[(?!\/?gm\])[^\]]*\][^\[]*)*\[\/gm\]$/.test(line)), true);
  assertIncludes("buttons stay after it", message, "```Identify_Item\nx\n```");
  assertNotIncludes("... and aren't wrapped", message, "[gm]```");

  const [noDC] = runHandler("skill.js", roll({ rollName: "Perception: Seek", secret: true }, 21, 15));
  assert("no DC: the line and the total", noDC.split("\n"), ["**Perception: Seek** (secret check)", "[gm]Secret check: 21 (d20: 15)[/gm]"]);

  const [open, dice] = runHandler("skill.js", roll({ dc: 15, rollName: "Athletics: Climb" }));
  assert("not secret: the dice and the card as before", [dice?.total, open.includes("(secret check)")], [19, false]);
}

process.exitCode = summary() > 0 ? 1 : 0;
