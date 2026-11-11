// Supplementary reading for the existing cross-module quiz. Question/version and
// submitted answer records stay unchanged; source materials are the approved modules.
export function crossCourseReading(reference){
  const modules=reference.modules;
  const selected=[modules[0],modules[1],modules[2],modules[5],modules[6],modules[7]];
  return {
    reading:[
      '本课把出车检查、疲劳与分心、路口观察、辅助驾驶和案例复盘结合起来。请先阅读以下材料，再完成情境题；课程测验不替代当班安全处置。',
      ...selected.map(m=>`${m.title}：${m.action}`),
      ...selected.flatMap(m=>m.reading.filter(p=>/教学情境|情境：|场景：/.test(p))),
      '数据与身份核查：车辆记录不直接等于当前绑定司机的当班行为。缺少可靠当班身份时，应先核实车辆、人员与事件；不能把历史风险直接归责个人。报警减少也可能与离线或行驶量变化有关，应核对覆盖、暴露量和经复核的实际行为。',
      '研究口径：资料中的关联因素可能同时存在，研究对象、地区和时期也有限制；不能简单相加解释事故原因。答题成绩反映本次知识掌握，后续还需落实行动计划并安排复查。'
    ],
    action:'先处理当班安全状态与车辆问题；驾驶中不处理手机消息；按通行要求停让并观察；核对辅助功能边界与设备质量；区分事实和推测，提出可执行的替代行为并约定复查',
    links:[...new Map(selected.flatMap(m=>m.links||[]).map(l=>[l.url,l])).values()]
  };
}
