declare global { interface Window { guard:any } }
import "./style.css";
const app=document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML=`<header><div><h1>Codex Quota Guard</h1><p>本地运行 · 账号隔离 · 5 小时额度保护</p></div><span id="state" class="pill">启动中</span></header>
<section class="panel"><h2>当前账号</h2><div class="email" id="email">读取中…</div><div class="muted" id="plan"></div><div class="quota-grid">
<div class="quota-card"><div class="quota-head"><strong>5 小时额度</strong><span id="fiveStatus" class="mini-status">等待数据</span></div><div class="meter"><div id="fiveBar"></div></div><div class="quota"><strong id="fiveRemaining">—</strong><span>剩余</span><small id="fiveUsed">已使用 —</small></div><p class="muted" id="fiveReset">重置时间：—</p></div>
<div class="quota-card"><div class="quota-head"><strong>每周额度</strong><span id="weekStatus" class="mini-status">等待数据</span></div><div class="meter"><div id="weekBar"></div></div><div class="quota"><strong id="weekRemaining">—</strong><span>剩余</span><small id="weekUsed">已使用 —</small></div><p class="muted" id="weekReset">重置时间：—</p></div>
</div><p id="status" class="muted">正在连接 Codex App Server…</p></section>
<section class="panel"><h2>保护设置</h2><label>受保护账号 A 邮箱<input id="emailA" type="email" placeholder="输入账号 A 的 ChatGPT 邮箱"></label><label>Codex CLI 路径（可留空自动查找）<input id="codexPath" type="text" placeholder="例如 C:\\Users\\你的用户名\\AppData\\Roaming\\npm\\codex.cmd"></label><p class="muted">如果自动查找不到，请填写 codex.exe 或 codex.cmd 的完整路径。</p><label>网络代理地址（可选）<input id="proxyUrl" type="text" placeholder="例如 http://127.0.0.1:7890"></label><p class="muted">如果 Codex Desktop 可以联网，但额度读取失败，可填写代理软件的本地 HTTP 代理地址；端口以代理软件实际设置为准。留空则继承当前环境变量。</p><div class="grid">
<label>5 小时额度停止阈值（剩余 %）<input id="fiveHourThreshold" type="number" min="1" max="100" value="20"><small class="field-hint">仅控制 5 小时额度；剩余比例达到或低于此值时触发停止。</small></label>
<label>每周额度停止阈值（剩余 %）<input id="weeklyThreshold" type="number" min="1" max="100" value="20"><small class="field-hint">仅控制每周额度；剩余比例达到或低于此值时触发停止。</small></label>
</div>
<label>检查间隔（秒）<input id="poll" type="number" min="5" max="60" value="30"></label><label class="check"><input id="auto" type="checkbox">启用自动点击 Codex 停止按钮</label><div class="actions"><button id="save">保存设置</button><button class="secondary" id="test">测试停止按钮（会尝试停止当前任务）</button></div><p class="warn">首次使用请先关闭自动停止，完成账号识别与停止按钮测试。UI 自动化依赖 Codex 界面语言和版本，点击成功不等于任务已结束。</p></section>
<section class="panel"><h2>运行日志</h2><pre id="logs">等待日志…</pre></section><footer>仅在本机读取 Codex App Server 状态；不上传认证令牌。</footer>`;
const $=(id:string)=>document.getElementById(id)!;let currentFiveHourThreshold=20;let currentWeeklyThreshold=20;
function formatReset(value:number|null){if(!value)return "重置时间：暂无数据";const d=new Date(value*1000);return "重置时间："+d.toLocaleString();}
function renderQuota(prefix:string,used:number|null,reset:number|null){
 const rem=used==null?null:Math.max(0,100-used);
 $(prefix+"Remaining").textContent=rem==null?"—":rem.toFixed(0)+"%";
 $(prefix+"Used").textContent=used==null?"已使用 —":"已使用 "+used.toFixed(0)+"%";
 ($((prefix==="five"?"fiveBar":"weekBar")) as HTMLElement).style.width=(rem??0)+"%";
 $(prefix==="five"?"fiveReset":"weekReset").textContent=formatReset(reset);
 const threshold=prefix==="five"?currentFiveHourThreshold:currentWeeklyThreshold;$(prefix==="five"?"fiveStatus":"weekStatus").textContent=used==null?"暂无数据":((rem??0)<=threshold?"达到停止线":"正常");
}
function render(s:any){
 $("email").textContent=s.email||"未识别";$("plan").textContent=s.plan||"";
 $("state").textContent=s.protected?"账号 A 保护中":"未保护";
 $("state").className="pill "+(s.protected?"good":"");
 renderQuota("five",s.fiveHourUsedPercent,s.fiveHourResetsAt);
 renderQuota("week",s.weeklyUsedPercent,s.weeklyResetsAt);
 $("status").textContent=s.status;$("logs").textContent=(s.log||[]).join("\\n")||"暂无日志";
}
window.guard.getSnapshot().then(render);window.guard.onSnapshot(render);window.guard.getSettings().then((v:any)=>{currentFiveHourThreshold=Number(v.fiveHourThreshold??20);currentWeeklyThreshold=Number(v.weeklyThreshold??20);($("emailA") as HTMLInputElement).value=v.protectedEmail||"";($("codexPath") as HTMLInputElement).value=v.codexPath||"";($("proxyUrl") as HTMLInputElement).value=v.proxyUrl||"";($("fiveHourThreshold") as HTMLInputElement).value=String(v.fiveHourThreshold??v.threshold??20);($("weeklyThreshold") as HTMLInputElement).value=String(v.weeklyThreshold??v.threshold??20);($("poll") as HTMLInputElement).value=String(v.pollSeconds??30);($("auto") as HTMLInputElement).checked=!!v.autoStop;});
$("save").addEventListener("click",async()=>{currentFiveHourThreshold=Number(($("fiveHourThreshold") as HTMLInputElement).value)||20;currentWeeklyThreshold=Number(($("weeklyThreshold") as HTMLInputElement).value)||20;await window.guard.saveSettings({protectedEmail:($("emailA") as HTMLInputElement).value,fiveHourThreshold:currentFiveHourThreshold,weeklyThreshold:currentWeeklyThreshold,pollSeconds:Number(($("poll") as HTMLInputElement).value),proxyUrl:($("proxyUrl") as HTMLInputElement).value.trim(),autoStop:($("auto") as HTMLInputElement).checked,codexPath:($("codexPath") as HTMLInputElement).value.trim()});alert("设置已保存");});
$("test").addEventListener("click",async()=>{if(confirm("这会尝试点击 Codex 界面中的停止/取消按钮。确定继续？"))await window.guard.testStop();});