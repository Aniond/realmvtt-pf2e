// Tests for the shield gaps (armor-traits.js, applyDamage, the attack card).
// Run: node tests/test-shields.js   (or via tests/run-all.js)

const { createSandbox } = require("./sandbox");
const { assert, assertIncludes, assertNotIncludes, section, summary } = require("./test-helpers");

const ctx = createSandbox();

const steelShield = (hp = 20, traits = ["Common"]) => ({
  _id: "sh1",
  name: "Steel Shield",
  data: { type: "shield", carried: "equipped", acBonus: 2, hardness: 5, hp: { value: hp, max: 20 }, traits },
});
const shieldBlockFeat = { name: "Shield Block", data: { type: "feat" } };
const pc = (data) => ({ _id: "tok-pc", recordType: "characters", name: "Valeros", identified: true, record: { name: "Valeros" }, effects: [], data: { curhp: 40, hitpoints: 40, feats: [shieldBlockFeat], ...data } });
const npc = (data) => ({ _id: "tok-npc", recordType: "npcs", name: "Guard", identified: true, record: { name: "Guard" }, effects: [], data: { curhp: 30, hitpoints: 30, ...data } });

section("Shield Block: who can");
{
  assert("a character with the feat", ctx.hasShieldBlock(pc({})), true);
  assert("... without it", ctx.hasShieldBlock(pc({ feats: [] })), false);
  assert("an NPC with the ability", ctx.hasShieldBlock(npc({ actions: [{ name: "Shield Block" }] })), true);
  assert("... without it", ctx.hasShieldBlock(npc({ actions: [{ name: "Attack of Opportunity" }] })), false);
  const raised = { inventory: [steelShield()], shieldRaised: "true" };
  assert("raised, not broken, with Shield Block", ctx.canShieldBlock(pc(raised)), true);
  assert("not raised", ctx.canShieldBlock(pc({ ...raised, shieldRaised: "false" })), false);
  assert("broken: can't (a broken item can't be used)", ctx.canShieldBlock(pc({ ...raised, shieldBroken: true })), false);
  assert("no Shield Block", ctx.canShieldBlock(pc({ ...raised, feats: [] })), false);
  assert("no creature", ctx.canShieldBlock(null), false);
}

section("Hefty");
{
  assert("the number", [ctx.getShieldHefty(["Common", "Hefty-2"]), ctx.getShieldHefty(["Hefty 3"]), ctx.getShieldHefty(["Common"])], [2, 3, null]);
  const fortress = { inventory: [steelShield(20, ["Common", "Hefty-2"])] };
  assert("Strength under it: 2 actions", ctx.getRaiseShieldNote(pc({ ...fortress, str: 1 })), "Hefty 2: raising it takes 2 actions (Strength +1, under +2).");
  assert("Strength meets it: nothing", ctx.getRaiseShieldNote(pc({ ...fortress, str: 2 })), "");
  assert("not hefty: nothing", ctx.getRaiseShieldNote(pc({ inventory: [steelShield()], str: 0 })), "");
}

section("Broken follows the equipped shield");
{
  // What the sheet's recalculation writes
  const recalc = (data) => {
    const saved = ctx.api.setValuesOnRecord;
    const written = {};
    ctx.api.setValuesOnRecord = (rec, values) => Object.assign(written, values);
    try {
      ctx.updateAllAttributes(pc(data));
    } finally {
      ctx.api.setValuesOnRecord = saved;
    }
    return written;
  };
  assert("at the Broken Threshold: broken", recalc({ inventory: [steelShield(10)] })["data.shieldBroken"], true);
  const fresh = recalc({ inventory: [steelShield(20)], shieldBroken: true, shieldRaised: "true" });
  assert("a fresh shield in place of a broken one: not broken", fresh["data.shieldBroken"], false);
  const lowered = recalc({ inventory: [steelShield(20)], shieldBroken: true, shieldRaised: "false" });
  assert("... and raising it gives its AC", fresh["data.ac"] - lowered["data.ac"], 2);
  assert("no shield: not broken", recalc({ inventory: [], shieldBroken: true })["data.shieldBroken"], false);
  const noHp = { _id: "sh2", name: "Homebrew Shield", data: { type: "shield", carried: "equipped", acBonus: 2 } };
  assert("a shield with no Hit Points filled in: not broken", recalc({ inventory: [noHp], shieldBroken: true })["data.shieldBroken"], false);
  assert("unchanged: not written", "data.shieldBroken" in recalc({ inventory: [steelShield(20)] }), false);
}

section("Shield Block damage: broken, destroyed");
{
  let sets = [];
  ctx.api.setValuesOnTokenById = (id, type, values, cb) => {
    sets.push(values);
    if (cb) cb();
  };
  const hit = (amount) => ({ total: amount, types: [{ type: "bludgeoning", value: amount }], metadata: { damageType: "bludgeoning" } });
  const block = (shieldHp, amount) => {
    sets = [];
    ctx.__state.messages = [];
    const target = pc({ inventory: [steelShield(shieldHp)], shieldRaised: "true", shieldHp });
    ctx.applyDamage(target, hit(amount), false, null, true);
    return { message: ctx.__state.messages.join("\n"), values: Object.assign({}, ...sets) };
  };

  const broken = block(20, 15);
  assert("15 against Hardness 5: the shield takes 10, broken", [broken.values["data.inventory.0.data.hp.value"], broken.values["data.shieldBroken"]], [10, true]);
  assertIncludes("... the card says so", broken.message, "Shield is now BROKEN!");
  assert("... still raised", broken.values["data.shieldRaised"], undefined);

  const destroyed = block(8, 20);
  assert("to 0: destroyed, and lowered", [destroyed.values["data.inventory.0.data.hp.value"], destroyed.values["data.shieldRaised"]], [0, "false"]);
  assertIncludes("... the card says so", destroyed.message, "Shield is DESTROYED!");
  assertNotIncludes("... not also broken", destroyed.message, "now BROKEN");
}

process.exitCode = summary() > 0 ? 1 : 0;
