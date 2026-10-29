// A counteract check (Player Core pg. 431): the degree of success against
// the effect's DC, then whether the counteract rank beats the target's
// (check-tools.js)
const metadata = data?.roll?.metadata || {};
const roll = {
  ...data.roll,
  dice: [...(data?.roll?.dice || [])],
  total: data?.roll?.total !== undefined ? data?.roll?.total : 0,
};

const dc = parseInt(metadata.dc || "0", 10) || 0;
let message = "";

if (dc > 0) {
  const total = roll.total || 0;
  const d20 = (roll.dice || []).find((d) => d.type === 20 && d.reason !== "dropped");
  const natural = d20 ? parseInt(d20.value, 10) : 0;

  let degree = total >= dc + 10 ? 2 : total >= dc ? 1 : total <= dc - 10 ? -1 : 0;
  if (natural === 20 && degree < 2) degree += 1;
  else if (natural === 1 && degree > -1) degree -= 1;

  const names = { 2: "CRITICAL SUCCESS", 1: "SUCCESS", 0: "FAILURE", "-1": "CRITICAL FAILURE" };
  const colors = { 2: "green", 1: "lime", 0: "pink", "-1": "red" };
  const margin = total - dc;
  message = `**[center][color=${colors[degree]}]${names[degree]}[/color] [gm]vs DC ${dc} (${margin >= 0 ? "+" : ""}${margin})[/gm][/center]**`;

  const counteracted = getCounteractOutcome(degree, metadata.counteractRank, metadata.targetRank);
  message += counteracted
    ? `\n\n**Counteracted!** [gm](rank ${metadata.counteractRank} against rank ${metadata.targetRank})[/gm]`
    : `\n\n**Not counteracted.** [gm](rank ${metadata.counteractRank} against rank ${metadata.targetRank})[/gm]`;
}

api.sendMessage(message, roll, [], [
  { name: metadata.rollName || "Counteract", tooltip: metadata.tooltip || "Counteract Check" },
]);
