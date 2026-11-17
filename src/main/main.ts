import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } from "electron";
import { spawn, ChildProcessWithoutNullStreams, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import fs from "node:fs";

type Snapshot = { email: string|null; plan: string|null; usedPercent: number|null; windowMins: number|null; resetsAt: number|null; status: string; protected: boolean; lastAction: string|null; log: string[] };
let win: BrowserWindow|null=null, tray: Tray|null=null, proc: ChildProcessWithoutNullStreams|null=null;
let lastStopAt=0; let nextId=1; const pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
let snapshot:Snapshot={email:null,plan:null,usedPercent:null,windowMins:null,resetsAt:null,status:"初始化中",protected:false,lastAction:null,log:[]};
let cfg={protectedEmail:"",threshold:20,pollSeconds:12,autoStop:false,codexPath:""};
const configPath=()=>path.join(app.getPath("userData"),"settings.json");
const log=(s:string)=>{snapshot.log=[`${new Date().toLocaleTimeString()} ${s}`,...snapshot.log].slice(0,100); win?.webContents.send("snapshot",snapshot);};
function send(method:string,params:any={}):Promise<any>{
 return new Promise((resolve,reject)=>{if(!proc||!proc.stdin.writable)return reject(new Error("App Server 未运行"));
 const id=nextId++;pending.set(id,{resolve,reject});proc.stdin.write(JSON.stringify({method,id,params})+"\n");
 setTimeout(()=>{const p=pending.get(id);if(p){pending.delete(id);p.reject(new Error(method+" 请求超时"));}},10000).unref();});
}
function parseLimit(r:any){
 const buckets=r?.rateLimitsByLimitId||{}; const all=[...Object.values(buckets) as any[]];
 const candidates=all.filter(x=>Number(x?.primary?.windowDurationMins)>=240 && Number(x?.primary?.windowDurationMins)<=360);
 const b=candidates[0]||r?.rateLimits;
 if(!b?.primary||typeof b.primary.usedPercent!=="number")return null;
 return {used:b.primary.usedPercent,mins:b.primary.windowDurationMins??null,resets:b.primary.resetsAt??null};
}
async function refresh(){
 if (!proc) return; // Keep the actionable startup error visible when the CLI is missing/offline.
 try{
  const a=await send("account/read",{refreshToken:false}); const account=a?.account;
  snapshot.email=account?.email||null;snapshot.plan=account?.planType||null;
  if(!account?.email){snapshot.status="未登录或无法识别账号";snapshot.protected=false;snapshot.usedPercent=null;return publish();}
  const isA=cfg.protectedEmail.trim().toLowerCase()===account.email.toLowerCase();
  snapshot.protected=isA;
  const rr=await send("account/rateLimits/read"); const limit=parseLimit(rr?.rateLimits?rr:rr);
  if(!limit){snapshot.usedPercent=null;snapshot.status=isA?"账号 A 已识别，但未找到 5 小时额度窗口":"账号 B / 未启用保护";return publish();}
  snapshot.usedPercent=limit.used;snapshot.windowMins=limit.mins;snapshot.resetsAt=limit.resets;
  snapshot.status=isA?"账号 A 保护已启用":"当前账号不受额度保护";
  if(isA && limit.used>=100-cfg.threshold){
    snapshot.status="已达到停止阈值";
    if(cfg.autoStop && Date.now()-lastStopAt>60000){lastStopAt=Date.now();await stopCodexTask();}
  }
  publish();
 }catch(e:any){snapshot.status="监控异常："+e.message;log(snapshot.status);publish();}
}
function publish(){win?.webContents.send("snapshot",snapshot);}
async function stopCodexTask(){
 // Fail-safe: only click a visible, enabled button whose accessible name matches stop/cancel.
 const ps=app.isPackaged ? path.join(process.resourcesPath,"scripts","stop-codex.ps1") : path.join(app.getAppPath(),"scripts","stop-codex.ps1");
 const child=spawn("powershell.exe",["-NoProfile","-ExecutionPolicy","Bypass","-File",ps],{windowsHide:true});
 let out="";child.stdout.on("data",d=>out+=d.toString());child.stderr.on("data",d=>out+=d.toString());
 child.on("error",err=>{snapshot.lastAction="无法启动 PowerShell UI Automation："+err.message;log(snapshot.lastAction);publish();});
 child.on("close",code=>{snapshot.lastAction=out.trim()||`UIA exit ${code}`;log(snapshot.lastAction);if(code===0)new Notification({title:"codex-account-limit-management",body:"已向 Codex 停止按钮发送点击。请确认任务已停止。"}).show();publish();});
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
 let child: ChildProcessWithoutNullStreams;
 try {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(codexPath)) {
   // .cmd/.bat files must be launched through cmd.exe on Windows.
   const commandLine = `\"\"${codexPath}\" ${args.join(" ")}\"`;
   child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine], {
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true, windowsVerbatimArguments: true
   });
  } else {
   child = spawn(codexPath, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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
  send("initialize", { clientInfo: { name: "codex_quota_guard", title: "codex-account-limit-management", version: "0.1.1" } })
   .then(() => { if (proc === child && child.stdin.writable) child.stdin.write(JSON.stringify({ method: "initialized", params: {} }) + "\n"); })
   .then(refresh)
   .catch((e: any) => { snapshot.status = "App Server 初始化失败：" + e.message; log(snapshot.status); publish(); });
 });
}
function createWindow(){win=new BrowserWindow({width:760,height:680,minWidth:650,minHeight:580,webPreferences:{preload:path.join(__dirname,"preload.js"),contextIsolation:true,nodeIntegration:false}});
 if(!app.isPackaged)win.loadURL("http://127.0.0.1:2326");else win.loadFile(path.join(__dirname,"../../dist/index.html"));
 win.on("close",e=>{e.preventDefault();win?.hide();});}
app.whenReady().then(()=>{
 try{cfg={...cfg,...JSON.parse(fs.readFileSync(configPath(),"utf8"))};}catch{}
 createWindow();tray=new Tray(nativeImage.createEmpty());tray.setToolTip("codex-account-limit-management");tray.setContextMenu(Menu.buildFromTemplate([{label:"打开",click:()=>win?.show()},{label:"退出",click:()=>{proc?.kill();app.exit();}}]));
 startServer();setInterval(refresh,Math.max(5,cfg.pollSeconds)*1000);
});
ipcMain.handle("get-snapshot",()=>snapshot);
ipcMain.handle("get-settings",()=>cfg);
ipcMain.handle("save-settings",(_,v)=>{const oldPath=cfg.codexPath;cfg={...cfg,...v};fs.mkdirSync(path.dirname(configPath()),{recursive:true});fs.writeFileSync(configPath(),JSON.stringify(cfg,null,2));log("设置已保存");if(!proc || oldPath!==cfg.codexPath){if(proc)proc.kill();startServer();}else{refresh();}return cfg;});
ipcMain.handle("test-stop",()=>stopCodexTask());
app.on("before-quit",()=>proc?.kill());