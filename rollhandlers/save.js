const rollName = data?.roll?.metadata?.rollName;
const tooltip = data?.roll?.metadata?.tooltip;
const minRoll = data?.roll?.metadata?.minRoll;
const degreeOfSuccessAdjustments =
  data?.roll?.metadata?.degreeOfSuccessAdjustments;

// Find the unddropped d20, and if minroll is set
// alter the actual roll to be the minroll if it's lower
const roll = {
  ...data.roll,
  dice: [...(data?.roll?.dice || [])],
  total: data?.roll?.total !== undefined ? data?.roll?.total : 0,
};

if (roll.dice) {
  roll.dice = roll.dice.map((d) => {
    let value = parseInt(d.value, 10);
    if (d.type === 20 && d.reason !== "dropped") {
      if (minRoll && value < minRoll) {
        roll.total += minRoll - value;
        value = minRoll;
      }
    }
    return {
      ...d,
      value: value,
    };
  });
}

let message = "";

let dc = 0;
dc = parseInt(data?.roll?.metadata?.dc || "0", 10);
if (isNaN(dc)) {
  dc = 0;
}

// The degree of success the roll's notes are shown for (null: no DC)
let noteDegree = null;

if (dc > 0) {
  const total = roll.total || 0;

  // Find the natural d20 roll (not dropped)
  let naturalRoll = 0;
  if (roll.dice) {
    const d20 = roll.dice.find((d) => d.type === 20 && d.reason !== "dropped");
    if (d20) {
      naturalRoll = parseInt(d20.value, 10);
    }
  }

  // Calculate the degree of success or failure
  // PF2e Critical Success/Failure rules:
  // - Critical Success: Beat DC by 10+ OR natural 20 (upgrades success to crit success)
  // - Success: Meet or beat DC
  // - Failure: Miss DC
  // - Critical Failure: Miss DC by 10+ OR natural 1 (downgrades failure to crit failure)

  let degreeOfSuccess = 0; // 0 = failure, 1 = success, 2 = critical success, -1 = critical failure

  // First, determine base degree of success
  if (total >= dc + 10) {
    degreeOfSuccess = 2; // Critical Success
  } else if (total >= dc) {
    degreeOfSuccess = 1; // Success
  } else if (total <= dc - 10) {
    degreeOfSuccess = -1; // Critical Failure
  } else {
    degreeOfSuccess = 0; // Failure
  }

  // Apply natural 20/1 adjustments
  if (naturalRoll === 20 && degreeOfSuccess < 2) {
    degreeOfSuccess += 1; // Natural 20 improves degree by one step (max critical success)
  } else if (naturalRoll === 1 && degreeOfSuccess > -1) {
    degreeOfSuccess -= 1; // Natural 1 worsens degree by one step (min critical failure)
  }

  // Apply degree of success adjustments from effects/modifiers
  const adjustmentResult = applyDegreeOfSuccessAdjustment(
    degreeOfSuccess,
    degreeOfSuccessAdjustments
  );
  degreeOfSuccess = adjustmentResult.degree;
  noteDegree = degreeOfSuccess;
  const adjustmentModifierName = adjustmentResult.modifierName;

  // Calculate margin of success/failure
  const margin = total - dc;
  const marginText = margin >= 0 ? `+${margin}` : `${margin}`;

  // Generate appropriate message based on final degree of success
  const degreeNames = {
    2: "CRITICAL SUCCESS",
    1: "SUCCESS",
    0: "FAILURE",
    "-1": "CRITICAL FAILURE",
  };
  const degreeColors = {
    2: "green",
    1: "lime",
    0: "pink",
    "-1": "red",
  };

  const degreeName = degreeNames[degreeOfSuccess];
  const degreeColor = degreeColors[degreeOfSuccess];
  const modifierText = adjustmentModifierName
    ? ` [${adjustmentModifierName}]`
    : "";

  switch (degreeOfSuccess) {
    case 2:
      message = `**[center][color=${degreeColor}]${degreeName}${modifierText}[/color] [gm]vs DC ${dc} (${marginText})[/gm][/center]**`;
      break;
    case 1:
      message = `**[center][color=${degreeColor}]${degreeName}${modifierText}[/color] [gm]vs DC ${dc} (${marginText})[/gm][/center]**`;
      break;
    case 0:
      message = `**[center][color=${degreeColor}]${degreeName}${modifierText}[/color] [gm]vs DC ${dc} (${marginText})[/gm][/center]**`;
      break;
    case -1:
      message = `**[center][color=${degreeColor}]${degreeName}${modifierText}[/color] [gm]vs DC ${dc} (${marginText})[/gm][/center]**`;
      break;
  }
}

// Notes from the creature's features for this result (rollNote)
message += getRollNotesText(data?.roll?.metadata?.notes, noteDegree);

api.sendMessage(
  message,
  roll,
  [],
  [
    {
      name: rollName || "Save",
      tooltip: tooltip || `${rollName || ""} Saving Throw`,
    },
  ]
);
