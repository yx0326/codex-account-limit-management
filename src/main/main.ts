import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from "electron";
import { spawn, ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";

type Snapshot = { email: string|null; plan: string|null; fiveHourUsedPercent: number|null; fiveHourWindowMins: number|null; fiveHourResetsAt: number|null; weeklyUsedPercent: number|null; weeklyWindowMins: number|null; weeklyResetsAt: number|null; status: string; protected: boolean; lastAction: string|null; log: string[] };
let win: BrowserWindow|null=null, tray: Tray|null=null, proc: ChildProcessWithoutNullStreams|null=null;
let lastStopAt=0; let nextId=1; let refreshInFlight=false; let failureStreak=0; let refreshTimer:NodeJS.Timeout|null=null; const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
let snapshot:Snapshot={email:null,plan:null,fiveHourUsedPercent:null,fiveHourWindowMins:null,fiveHourResetsAt:null,weeklyUsedPercent:null,weeklyWindowMins:null,weeklyResetsAt:null,status:"初始化中",protected:false,lastAction:null,log:[]};
let cfg={protectedEmail:"",fiveHourThreshold:20,weeklyThreshold:20,pollSeconds:30,autoStop:false,codexPath:"",proxyUrl:""};
const configPath=()=>path.join(app.getPath("userData"),"settings.json");
const log=(s:string)=>{snapshot.log=[`${new Date().toLocaleTimeString()} ${s}`,...snapshot.log].slice(0,100); win?.webContents.send("snapshot",snapshot);};
function send(method:string,params:any={}):Promise<any>{
 return new Promise((resolve,reject)=>{
  if(!proc||!proc.stdin.writable)return reject(new Error("App Server 未运行"));
  const id=nextId++;
  const timeoutMs=method==="account/rateLimits/read"?30000:15000;
  const timer=setTimeout(()=>{
   const item=pending.get(id);
   if(item){pending.delete(id);item.reject(new Error(method+" 请求超时（"+timeoutMs+"ms）"));}
  },timeoutMs);
  pending.set(id,{
   resolve:(v:any)=>{clearTimeout(timer);resolve(v);},
   reject:(e:Error)=>{clearTimeout(timer);reject(e);}
  });
  try{proc.stdin.write(JSON.stringify({method,id,params})+"\n");}
  catch(e:any){clearTimeout(timer);pending.delete(id);reject(new Error("发送 "+method+" 失败："+e.message));}
 });
}
type QuotaWindow = { usedPercent:number; windowMins:number; resetsAt:number|null };
type QuotaPair = { fiveHour:QuotaWindow|null; weekly:QuotaWindow|null };

function parseQuotaWindows(response:any):QuotaPair {
 const buckets:any[]=[];
 const addBucket=(value:any)=>{
  if(!value || typeof value!=="object")return;
  if(value.primary || value.secondary) buckets.push(value);
  for(const child of Object.values(value)){
   if(child && typeof child==="object" && (child as any).primary || child && typeof child==="object" && (child as any).secondary){
    buckets.push(child);
   }
  }
 };
 // Prefer the per-limit map; also inspect the legacy aggregate object for compatibility.
 addBucket(response?.rateLimitsByLimitId);
 addBucket(response?.rateLimits);
 const seen=new Set<any>();
 const windows:QuotaWindow[]=[];
 for(const bucket of buckets){
  if(seen.has(bucket))continue;
  seen.add(bucket);
  for(const slot of ["primary","secondary"]){
   const item=bucket?.[slot];
   const mins=Number(item?.windowDurationMins);
   const used=Number(item?.usedPercent);
   if(!Number.isFinite(mins) || !Number.isFinite(used) || used<0 || used>100)continue;
   windows.push({
    usedPercent:used,
    windowMins:mins,
    resetsAt:typeof item?.resetsAt==="number"?item.resetsAt:null
   });
  }
 }
 // Identify windows by duration, never by primary/secondary position alone.
 const fiveHour=windows.find(x=>x.windowMins>=240 && x.windowMins<=360) || null;
 const weekly=windows.find(x=>x.windowMins>=6*24*60 && x.windowMins<=8*24*60) || null;
 return {fiveHour,weekly};
}
async function refresh(){
 if(!proc || refreshInFlight) return;
 refreshInFlight=true;
 let success=false;
 try{
  const a=await send("account/read",{refreshToken:false}); const account=a?.account;
  snapshot.email=account?.email||null;snapshot.plan=account?.planType||null;
  if(!account?.email){
   snapshot.protected=false;
   snapshot.fiveHourUsedPercent=null;snapshot.fiveHourWindowMins=null;snapshot.fiveHourResetsAt=null;
   snapshot.weeklyUsedPercent=null;snapshot.weeklyWindowMins=null;snapshot.weeklyResetsAt=null;
   snapshot.status="未登录或无法识别账号";success=true;return;
  }
  const isA=cfg.protectedEmail.trim().toLowerCase()===account.email.toLowerCase();
  snapshot.protected=isA;
  // Account B is deliberately excluded from quota polling and stop decisions.
  if(!isA){
   snapshot.fiveHourUsedPercent=null;snapshot.fiveHourWindowMins=null;snapshot.fiveHourResetsAt=null;
   snapshot.weeklyUsedPercent=null;snapshot.weeklyWindowMins=null;snapshot.weeklyResetsAt=null;
   snapshot.status="当前账号不受额度保护";failureStreak=0;success=true;return;
  }

  const rr=await send("account/rateLimits/read");
  const quotas=parseQuotaWindows(rr);
  snapshot.fiveHourUsedPercent=quotas.fiveHour?.usedPercent??null;
  snapshot.fiveHourWindowMins=quotas.fiveHour?.windowMins??null;
  snapshot.fiveHourResetsAt=quotas.fiveHour?.resetsAt??null;
  snapshot.weeklyUsedPercent=quotas.weekly?.usedPercent??null;
  snapshot.weeklyWindowMins=quotas.weekly?.windowMins??null;
  snapshot.weeklyResetsAt=quotas.weekly?.resetsAt??null;

  if(!quotas.fiveHour && !quotas.weekly){
   snapshot.status="账号 A 已识别，但未找到有效的 5 小时或每周额度窗口";
   success=true;return;
  }

  const fiveHourStopAt=100-Number(cfg.fiveHourThreshold??20);
  const weeklyStopAt=100-Number(cfg.weeklyThreshold??20);
  const fiveHourLow=!!quotas.fiveHour && quotas.fiveHour.usedPercent>=fiveHourStopAt;
  const weeklyLow=!!quotas.weekly && quotas.weekly.usedPercent>=weeklyStopAt;
  const reasons:string[]=[];
  if(fiveHourLow)reasons.push("5 小时额度");
  if(weeklyLow)reasons.push("每周额度");

  if(reasons.length){
   snapshot.status="达到停止阈值："+reasons.join("、");
   if(cfg.autoStop && Date.now()-lastStopAt>60000){
    lastStopAt=Date.now();
    log("触发自动停止："+reasons.join("、"));
    await stopCodexTask();
   }
  }else{
   const missing:string[]=[];
   if(!quotas.fiveHour)missing.push("5 小时额度未返回");
   if(!quotas.weekly)missing.push("每周额度未返回");
   snapshot.status=missing.length
    ?"账号 A 保护中；"+missing.join("，")+"，当前仅按已获取额度判断"
    :"账号 A 双额度保护中";
  }
  failureStreak=0;success=true;
 }catch(e:any){
  failureStreak++;
  // A failed fetch must never be mistaken for fresh quota data.
  snapshot.fiveHourUsedPercent=null;snapshot.weeklyUsedPercent=null;
  snapshot.status="监控异常："+e.message;
  log(snapshot.status);
 }finally{
  refreshInFlight=false;
  publish();
  if(proc){
   const base=Math.max(5,Number(cfg.pollSeconds)||30)*1000;
   const delay=success?base:Math.min(120000,Math.max(base,15000)*Math.pow(2,Math.min(failureStreak-1,3)));
   if(refreshTimer)clearTimeout(refreshTimer);
   refreshTimer=setTimeout(()=>{void refresh();},delay);
  }
 }
}
function publish(){win?.webContents.send("snapshot",snapshot);}
async function stopCodexTask(){
 // Fail-safe: only click a visible, enabled button whose accessible name matches stop/cancel.
 const ps=app.isPackaged ? path.join(process.resourcesPath,"scripts","stop-codex.ps1") : path.join(app.getAppPath(),"scripts","stop-codex.ps1");
 const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File",ps],{windowsHide:true});
 let out="";child.stdout.on("data",d=>out+=d.toString());child.stderr.on("data",d=>out+=d.toString());
 child.on("error",err=>{snapshot.lastAction="无法启动 PowerShell UI Automation："+err.message;log(snapshot.lastAction);publish();});
 child.on("close",code=>{snapshot.lastAction=out.trim()||`UIA exit ${code}`;log(snapshot.lastAction);if(code===0)new Notification({title:"Codex Quota Guard",body:"已向 Codex 停止按钮发送点击。请确认任务已停止。"}).show();publish();});
}
function resolveCodexCommand(): string | null {
 // 1) Explicit path from settings / environment has highest priority.
 const explicit = (cfg.codexPath || process.env.CODEX_PATH || "").trim().replace(/^\"|\"$/g, "");
 const candidates: string[] = [];
 if (explicit) candidates.push(explicit);
 // 2) PATH lookup. `where.exe` understands Windows PATHEXT and finds codex.cmd too.
 if (process.platform === "win32") {
  try {
   const found = execFileSync("where.exe", ["codex"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
   candidates.push(...found.split(/\r?\n/).map(x => x.trim()).filter(Boolean));
  } catch { /* Not in PATH; try common install locations below. */ }
  const appData = process.env.APPDATA || "";
  const userProfile = process.env.USERPROFILE || "";
  const localAppData = process.env.LOCALAPPDATA || "";
  candidates.push(
   path.join(userProfile, ".local", "bin", "codex.exe"),
   path.join(appData, "npm", "codex.cmd"),
   path.join(appData, "npm", "codex.exe"),
   path.join(localAppData, "Programs", "Codex", "codex.exe")
  );
 } else {
  try { candidates.push(execFileSync("which", ["codex"], { encoding: "utf8" }).trim()); } catch { /* ignore */ }
 }
 for (const candidate of candidates) {
  if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
 }
 return null;
}
function startServer(){
 const codexPath = resolveCodexCommand();
 if (!codexPath) {
  proc = null;
  snapshot.status = "找不到 Codex CLI。请安装 Codex CLI，或在设置中指定 codex.exe / codex.cmd 路径。";
  log(snapshot.status);
  publish();
  return;
 }
 log("已找到 Codex CLI：" + codexPath);
 const args = ["app-server", "--listen", "stdio://"];
 const serverEnv={...process.env};
 const proxy=(cfg.proxyUrl||"").trim();
 if(proxy){
  serverEnv.HTTP_PROXY=proxy;serverEnv.HTTPS_PROXY=proxy;serverEnv.ALL_PROXY=proxy;
  serverEnv.http_proxy=proxy;serverEnv.https_proxy=proxy;serverEnv.all_proxy=proxy;
 }
 let child: ChildProcessWithoutNullStreams;
 try {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(codexPath)) {
   // .cmd/.bat files must be launched through cmd.exe on Windows.
   const commandLine = `\"\"${codexPath}\" ${args.join(" ")}\"`;
   child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: true, env:serverEnv
   });
  } else {
   child = spawn(codexPath, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env:serverEnv });
  }
 } catch (e: any) {
  snapshot.status = "启动 Codex CLI 失败：" + (e?.message || String(e));
  log(snapshot.status); publish(); return;
 }
 proc = child;
 const rl = createInterface({ input: child.stdout });
 rl.on("line", line => {
  try {
   const m = JSON.parse(line);
   if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id)!; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message || "RPC error")) : p.resolve(m.result);
   }
  } catch { log("忽略无法解析的 App Server 输出"); }
 });
 child.stderr.on("data", d => log("App Server: " + d.toString().trim()));
 child.on("error", err => {
  if (proc === child) proc = null;
  snapshot.status = `无法启动 Codex CLI（${err.message}）。请检查 CLI 路径或安装情况。`;
  log(snapshot.status); publish();
 });
 child.on("exit", (code, signal) => {
  if (proc === child) proc = null;
  for (const [id, item] of pending) { item.reject(new Error("Codex App Server 已退出")); pending.delete(id); }
  snapshot.status = `Codex App Server 已退出（code=${code}, signal=${signal || "无"}）`;
  log(snapshot.status); publish();
 });
 child.once("spawn", () => {
  send("initialize", { clientInfo: { name: "codex_quota_guard", title: "Codex Quota Guard", version: "0.1.7" } })
   .then(() => { if (proc === child && child.stdin.writable) child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n"); })
   .then(refresh)
   .catch((e: any) => { snapshot.status = "App Server 初始化失败：" + e.message; log(snapshot.status); publish(); });
 });
}
function createWindow(){win=new BrowserWindow({width:760,height:680,minWidth:650,minHeight:580,webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false}});
 if(!app.isPackaged)win.loadURL("http://127.0.0.1:2326");else win.loadFile(path.join(__dirname,"../../dist/index.html"));
 win.on("close",e=>{e.preventDefault();win?.hide();});}
app.whenReady().then(()=>{
 try{
  const saved=JSON.parse(fs.readFileSync(configPath(),"utf8"));
  cfg={...cfg,...saved};
  if(saved.fiveHourThreshold==null && saved.threshold!=null)cfg.fiveHourThreshold=Number(saved.threshold);
  if(saved.weeklyThreshold==null && saved.threshold!=null)cfg.weeklyThreshold=Number(saved.threshold);
 }catch{}
 createWindow();tray=new Tray(nativeImage.createEmpty());tray.setToolTip("Codex Quota Guard");tray.setContextMenu(Menu.buildFromTemplate([{label:"打开",click:()=>win?.show()},{label:"退出",click:()=>{if(refreshTimer)clearTimeout(refreshTimer);proc?.kill();app.exit();}}]));
 startServer();
});
ipcMain.handle("get-snapshot",()=>snapshot);
ipcMain.handle("get-settings",()=>cfg);
ipcMain.handle("save-settings",(_,v)=>{const oldPath=cfg.codexPath,oldProxy=cfg.proxyUrl;cfg={...cfg,...v};fs.mkdirSync(path.dirname(configPath()),{recursive:true});fs.writeFileSync(configPath(),JSON.stringify(cfg,null,2));log("设置已保存");if(!proc || oldPath!==cfg.codexPath || oldProxy!==cfg.proxyUrl){if(refreshTimer)clearTimeout(refreshTimer);if(proc){const old=proc;proc=null;old.kill();}startServer();}else{void refresh();}return cfg;});
ipcMain.handle("test-stop",()=>stopCodexTask());
app.on("before-quit",()=>{if(refreshTimer)clearTimeout(refreshTimer);proc?.kill();});