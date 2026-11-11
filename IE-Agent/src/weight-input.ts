export type WeightInputs = Record<string, string>;

// Edit in 0.01 percentage points. Balance display rounding so a valid loaded
// version always displays 100%, without changing its precise stored weights.
export function weightInputs(weights: Record<string, number>): WeightInputs {
  const rows = Object.entries(weights).map(([key, value]) => {
    const exact = value * 10000;
    return { key, units: Math.floor(exact), fraction: exact - Math.floor(exact) };
  });
  const target = Math.round(Object.values(weights).reduce((s, v) => s + v, 0) * 10000);
  const remainder = target - rows.reduce((s, r) => s + r.units, 0);
  [...rows].sort((a, b) => b.fraction - a.fraction).slice(0, remainder).forEach(r => r.units++);
  return Object.fromEntries(rows.map(r => [r.key, String(r.units / 100)]));
}

export function weightTotal(inputs: WeightInputs) {
  return Object.values(inputs).reduce((s, v) => s + Math.round((Number(v) || 0) * 100), 0) / 100;
}

export function editWeight(inputs: WeightInputs, key: string, text: string) {
  if (!/^\d*(?:\.\d{0,2})?$/.test(text)) return null;
  const others = Object.entries(inputs).filter(([k]) => k !== key)
    .reduce((s, [, v]) => s + Math.round((Number(v) || 0) * 100), 0);
  const maxUnits = Math.max(0, 10000 - others);
  const limited = Math.round((Number(text) || 0) * 100) > maxUnits;
  return { inputs: { ...inputs, [key]: limited ? String(maxUnits / 100) : text }, limited, maximum: maxUnits / 100 };
}

export function inputWeights(inputs: WeightInputs) {
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, (Number(v) || 0) / 100]));
}

export function weightInputError(inputs: WeightInputs) {
  if (Object.values(inputs).some(v => !/^\d+(?:\.\d{0,2})?$/.test(v) && !/^\.\d{1,2}$/.test(v))) return '请完整填写每个维度的权重；不参与评分的维度请填 0。';
  const total = weightTotal(inputs);
  return total === 100 ? '' : `权重合计必须为 100%，当前为 ${total}%，${total < 100 ? '还差' : '超出'} ${Number(Math.abs(100 - total).toFixed(2))}%。`;
}
