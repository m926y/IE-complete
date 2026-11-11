import { ApiError } from "./api";
import { EmptyState } from "./ui";

export const driverDimensions = [["history_contribution", "历史"], ["fatigue_distraction_contribution", "疲劳分心"], ["driving_stability_contribution", "驾驶稳定性"], ["road_rule_contribution", "道路规则"], ["management_contribution", "管理配合"], ["imu_evidence_contribution", "车辆运行状态"]] as const;
export const trainingStatusNames: Record<string, string> = { assigned: "待开始", in_progress: "学习中", submitted: "待人工复核", returned: "需补充", reviewed: "复核通过", observation: "继续观察", interview: "需面谈" };

export function finiteValue(value: unknown): number | null {
  if (value == null || !["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const number = Number(value); return Number.isFinite(number) ? number : null;
}
export function numberText(value: unknown, digits = 2): string {
  return finiteValue(value)?.toFixed(digits) ?? "—";
}
export function DriverReadError({ error, retry }: { error: unknown; retry: () => void }) {
  const code = error instanceof ApiError ? error.code : "network";
  if (["binding_required", "binding_not_verified"].includes(code)) return <EmptyState kind="nocov" hint="当前账号尚未完成已核实司机绑定，请联系安全管理员。" />;
  if (error instanceof ApiError && [403, 404].includes(error.status)) return <EmptyState kind="noperm" hint="记录不存在或当前账号无权查看。" />;
  return <EmptyState kind="error" hint="暂时无法读取，请稍后重试。" onRetry={retry} />;
}

export const driverText=(v:unknown)=>({checking:'核查中',answered:'已答复',awaiting_data_owner:'待核验数据',high:'高',medium:'中',low:'低',history:'历史事故与险情',driving_stability:'驾驶稳定性',fatigue_distraction:'疲劳与分心',road_rule:'道路规则',management:'管理配合',imu_evidence:'车辆运行状态',sent:'已发送',read:'已读',replied:'已回复',pending_review:'待核实',confirmed:'已确认',closed:'已结束',duplicate:'重复提醒',needs_more:'待补充',...trainingStatusNames} as Record<string,string>)[String(v)]||String(v||'—');
export const driverDate=(v:unknown)=>v&&!Number.isNaN(Date.parse(String(v)))?new Date(String(v)).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
