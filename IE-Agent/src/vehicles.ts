import { api } from './api';

const labels = new Map<string, string>();
export const vehicleOptions = () => [...labels].map(([gpsno, label]) => ({ gpsno, label }));
export async function loadVehicleLabels() {
  labels.clear();
  const result = await api<{ rows: { gpsno: string; label: string }[] }>('/api/vehicles/labels');
  for (const row of result.rows) labels.set(row.gpsno, row.label);
}
export function vehicleLabel(gps: unknown) {
  if (gps === null || gps === undefined || gps === '') return '未绑定车辆';
  return labels.get(String(gps)) || '车辆信息待同步';
}
export function vehicleId(input: string) {
  const value = input.trim();
  for (const [gps, label] of labels) if (label === value || label === `车辆${value}`) return gps;
  return value;
}
export function displayText(value: unknown) {
  let out = String(value ?? '');
  for (const [gps, label] of labels) out = out.split(gps).join(label);
  return out.replace(/车辆\s*车辆/g, '车辆');
}
