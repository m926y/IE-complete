// Keep stored assessment evidence unchanged; present the reflection in everyday language.
export function reflectionPrompt(prompt: string): string {
 const topics: [RegExp,string][] = [
 [/左车道偏移|右车道偏移|长时间压线|驾驶稳定性/,'车辆偏离车道或压线'],
 [/疲劳|打哈欠|闭眼/,'疲劳或注意力不集中'],
 [/分心|手机|抽烟/,'驾驶时分心'],
 [/车距|碰撞|跟车/,'跟车距离和前方车辆变化'],
 [/超速|速度/,'车速控制'],
 [/盲区|转弯/,'转弯和盲区观察']
 ];
 if(!/常见报警线索|原始条数|请先辨别必要操作|当前数据可信度低|评分主要关注/.test(prompt)) return prompt;
 if(/可信度低/.test(prompt)) return '请回想一次收到提醒的经历：当时路况和车辆情况怎么样？提醒是否符合实际，还是需要检查设备？请用约100字说明你会怎样核实，以及接下来准备采取哪些安全措施。';
 const relevant=topics.filter(([pattern])=>pattern.test(prompt)).map(([,name])=>name).slice(0,2);
 return '请回想近期驾驶中'+(relevant.length?'与'+relevant.join('、')+'有关的一次经历':'一次需要特别注意安全的经历')+'：当时发生了什么，你为什么那样操作？这可能带来什么危险？如果再遇到类似情况，你会怎样做得更安全？请用约100字说说你的想法和具体做法。';
}
