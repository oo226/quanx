// PingMe for Surge — capture + sniff + cron + on-demand DIRECT for ads
// 仓库路径：/.github/workflows/pingme_surge.js

// ====== 存储键 ======
const K = {
  UA: 'pingme.ua',
  CK_URL: 'pingme.checkin.url',
  CK_MTD: 'pingme.checkin.method',
  CK_BDY: 'pingme.checkin.body',
  AD_URL: 'pingme.ad.url',
  AD_MTD: 'pingme.ad.method',
  AD_BDY: 'pingme.ad.body',
  FLAG_TS: 'pingme.flag.ts',   // 最近一次“正在使用 PingMe”的时间戳
};

// ====== 工具 ======
const read  = k => $persistentStore.read(k) || '';
const write = (k,v) => $persistentStore.write(String(v ?? ''), k);
const notify = (t,s='',b='') => { try{$notification.post(t,s,b);}catch{} };
const brief = s => (s||'').length>200 ? (s||'').slice(0,200)+'…' : (s||'');
const nowStr = () => { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const patchSignDate = url =>
  /[?&]signDate=/.test(url)
    ? url.replace(/([?&])signDate=[^&]*/i,(_,p)=>`${p}signDate=${encodeURIComponent(nowStr())}`)
    : url;

function http(method,url,ua,body,cb){
  const headers={}; if(ua) headers['User-Agent']=ua;
  const opt={url,headers,timeout:30};
  const M=(method||'GET').toUpperCase();
  if(M==='POST' && body){ opt.body=body; }
  (M==='POST'?$httpClient.post:$httpClient.get)(opt,cb);
}
const j = s => { try{return JSON.parse(s);}catch{return null;} };

// ====== 参数 / 模式 ======
const ARG  = (()=>{ try{ return Object.fromEntries(new URLSearchParams($argument||'')); }catch{ return {}; } })();
const MODE = (ARG.mode||'').toLowerCase();

// ====== A) 按需直连：仅在“使用窗口”内对广告域返回 DIRECT ======
if (typeof $request !== 'undefined' && MODE==='ads'){
  const winSec = Number(ARG.win||'180'); // 窗口期：默认 180 秒，可在模块里通过 &win=300 调整
  const ts = Number(read(K.FLAG_TS)||0);
  const ok = ts && (Date.now()-ts) < winSec*1000;
  // 窗口期内把该请求改为 DIRECT；否则不干预，交给你的去广告规则
  $done(ok ? { policy: 'DIRECT' } : {});
  // 不打扰：不弹通知
  return;
}

// 命中 PingMe 任何业务接口时，刷新“正在使用”标记（不给通知）
if (typeof $request !== 'undefined' && MODE==='flag'){
  write(K.FLAG_TS, Date.now());
  $done({});
  return;
}

// ====== B) 捕获 / 嗅探 ======
if (typeof $request !== 'undefined' && MODE==='capture'){
  // 请求阶段捕获：/app/checkIn 与 /app/videoBonus（无需解密）
  const url = $request.url || '';
  const mtd = ($request.method||'GET').toUpperCase();
  const ua  = ($request.headers?.['User-Agent']||$request.headers?.['user-agent']||'')+'';
  if (ua) write(K.UA, ua);
  if (/\/app\/checkIn\?/i.test(url)) {
    write(K.CK_URL,url); write(K.CK_MTD,mtd); if(mtd!=='GET' && $request.body) write(K.CK_BDY,$request.body);
    notify('✅ 已捕获【签到】请求','',url);
  } else if (/\/app\/videoBonus\?/i.test(url)) {
    write(K.AD_URL,url); write(K.AD_MTD,mtd); if(mtd!=='GET' && $request.body) write(K.AD_BDY,$request.body);
    notify('✅ 已捕获【视频奖励】请求','',url);
  } else if (/\/app\//i.test(url)) {
    // 方便排查：命中 pingme /app/ 任意请求也提示一下
    notify('命中请求 (PingMe)', '', brief(url));
  }
  $done({});
  return;
}

if (typeof $response !== 'undefined' && MODE==='sniff'){
  // 响应阶段嗅探：retcode=0 且出现 bonusHint/bonus/aftercredit 等字段就保存（需 MITM）
  try{
    const url = $request.url || '';
    const ct  = (''+($response.headers?.['Content-Type']||$response.headers?.['content-type']||'')).toLowerCase();
    const body= typeof $response.body==='string' ? $response.body : '';
    const isJ = ct.includes('application/json') || /^\s*[\{\[]/.test(body);
    if (isJ){
      const d=j(body)||{}; const r=d.result||{}; const hint=(r.bonusHint||'')+'';
      const ok = d.retcode===0 && (hint.includes('广告')||hint.includes('观看')||r.bonus!=null||r.aftercredit!=null||r.totalbonus!=null||r.allbonus!=null);
      if (ok){
        const isCk = /\/app\/checkIn\?/i.test(url);
        write(isCk?K.CK_URL:K.AD_URL, url);
        notify(`✅ 嗅探到${isCk?'签到':'视频奖励'}响应`, '', hint || brief(JSON.stringify(r)));
      }
    }
  }catch{}
  $done({});
  return;
}

// ====== C) 定时 / 手动运行 ======
if (typeof $request === 'undefined' && typeof $response === 'undefined'){
  const ua = read(K.UA);

  function runOne(which, done){
    const isCk = which==='checkin';
    const url  = read(isCk?K.CK_URL:K.AD_URL);
    const mtd  = (read(isCk?K.CK_MTD:K.AD_MTD)||'GET').toUpperCase();
    const bdy  = read(isCk?K.CK_BDY:K.AD_BDY)||'';
    if (!url){ notify('PingMe 任务未捕获', isCk?'缺少“签到”URL':'缺少“视频奖励”URL', '请先在 App 各操作一次'); done&&done(new Error('no-url')); return; }

    http(mtd,url,ua,bdy,(e1,r1,d1)=>{
      let ok=false,msg='';
      if(!e1){ const p1=j(d1)||{}; ok=p1.retcode===0; msg=p1.retmsg||p1.msg||''; }
      if(ok){ notify(`PingMe ${isCk?'签到':'视频奖励'}`,'成功',msg); done&&done(null); return; }
      // 改 signDate 再试一次（GET）
      const patched = patchSignDate(url);
      http('GET',patched,ua,'',(e2,r2,d2)=>{
        const p2=j(d2)||{}; const ok2=p2.retcode===0; const m2=p2.retmsg||p2.msg||'';
        notify(`PingMe ${isCk?'签到':'视频奖励'}`, ok2?'成功(改signDate)':'失败', ok2?m2:(e1?String(e1):msg||''));
        done&&done(ok2?null:new Error('fail'));
      });
    });
  }

  if (MODE==='checkin'){ runOne('checkin', ()=> $done()); }
  else if (MODE==='ad'){ runOne('ad', ()=> $done()); }
  else { // 无参数：先签到再广告（如果都已捕获）
    runOne('checkin', ()=> runOne('ad', ()=> $done()));
  }
}