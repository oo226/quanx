// PingMe for Surge — 稳定版：签到自动化 + 广告按需直连 + 捕获/嗅探 + 调试提示
// by oo226 + chatgpt

const K = {
  UA: 'pingme.ua',
  CK_URL: 'pingme.checkin.url', CK_MTD: 'pingme.checkin.method', CK_BDY: 'pingme.checkin.body', CK_TS:'pingme.checkin.ts',
  AD_URL: 'pingme.ad.url',      AD_MTD: 'pingme.ad.method',      AD_BDY: 'pingme.ad.body',      AD_TS:'pingme.ad.ts',
  FLAG_TS: 'pingme.flag.ts',
};

const R = k => $persistentStore.read(k) || '';
const W = (k,v) => $persistentStore.write(String(v ?? ''), k);
const N = (t,s='',b='') => { try{$notification.post(t,s,b);}catch{} };
const brief = s => (s||'').length>220 ? (s||'').slice(0,220)+'…' : (s||'');
const J = s => { try{return JSON.parse(s)}catch{return null} };

const ARG  = (()=>{ try{ return Object.fromEntries(new URLSearchParams($argument||'')); }catch{ return {}; } })();
const MODE = (ARG.mode||'').toLowerCase();
const DBG  = (ARG.dbg||'0')==='1';

/* ========== 按需直连广告域（窗口内） ========== */
if (typeof $request!=='undefined' && MODE==='ads'){
  const winSec = Number(ARG.win||'240');
  const ts = Number(R(K.FLAG_TS)||0);
  const ok = ts && (Date.now()-ts) < winSec*1000;
  if (ok) $done({ policy: 'DIRECT' }); else $done({});
  return;
}

/* ========== 标记使用中（点亮窗口） ========== */
if (typeof $request!=='undefined' && MODE==='flag'){
  W(K.FLAG_TS, Date.now());
  if (DBG) N('PingMe Flag','窗口已激活', $request.url||'');
  $done({});
  return;
}

/* ========== 捕获（请求阶段） ========== */
if (typeof $request!=='undefined' && MODE==='capture'){
  const url=$request.url||'';
  const mtd=($request.method||'GET').toUpperCase();
  const ua =($request.headers?.['User-Agent']||$request.headers?.['user-agent']||'')+'';
  if (ua) W(K.UA, ua);

  const isCheck = /\/app\/checkIn\b/i.test(url) || /[?&]check/i.test(url);
  const isVideo = /\/app\/videoBonus\b/i.test(url) || /bonus|ad|reward|credit/i.test(url);

  if (isCheck){
    W(K.CK_URL,url); W(K.CK_MTD,mtd); if(mtd!=='GET' && $request.body) W(K.CK_BDY,$request.body); W(K.CK_TS,Date.now());
    N('✅ 已捕获【签到】请求','',brief(url));
  } else if (isVideo){
    W(K.AD_URL,url); W(K.AD_MTD,mtd); if(mtd!=='GET' && $request.body) W(K.AD_BDY,$request.body); W(K.AD_TS,Date.now());
    N('✅ 已捕获【视频奖励】请求','',brief(url));
  } else if (/\/app\//i.test(url) && DBG){
    N('命中请求 (PingMe)','',brief(url));
  }
  $done({});
  return;
}

/* ========== 嗅探（响应阶段，需要 MITM） ========== */
if (typeof $response!=='undefined' && MODE==='sniff'){
  try{
    const url=$request.url||'';
    const ct  = (''+($response.headers?.['Content-Type']||$response.headers?.['content-type']||'')).toLowerCase();
    const body= typeof $response.body==='string' ? $response.body : '';
    const isJ = ct.includes('application/json') || /^\s*[\{\[]/.test(body);
    if (isJ){
      const d=J(body)||{}; const r=d.result||{}; const hint=(r.bonusHint||'')+'';
      const looks = d.retcode===0 && (hint.includes('广告')||hint.includes('观看')||r.bonus!=null||r.aftercredit!=null||r.totalbonus!=null||r.allbonus!=null||r.checkintimes!=null);
      if (looks){
        const isCk = /check/i.test(url) || /checkin/i.test(url);
        if (isCk){ W(K.CK_URL,url); W(K.CK_TS,Date.now()); }
        else     { W(K.AD_URL,url); W(K.AD_TS,Date.now()); }
        N(`✅ 嗅探到${isCk?'签到':'视频奖励'}响应`, '', hint || brief(JSON.stringify(r)));
      }
    }
  }catch(e){ if(DBG) N('Sniff 异常','',String(e)); }
  $done({});
  return;
}

/* ========== 定时/手动：签到可自动；广告只提示 ========== */
if (typeof $request==='undefined' && typeof $response==='undefined'){
  const ua = R(K.UA);

  function http(m,u,a,b,cb){
    const opt={url:u,headers:a?{'User-Agent':a}:undefined};
    const f=(m==='POST')?$httpClient.post:$httpClient.get;
    if(m==='POST' && b) opt.body=b;
    f(opt,(e,r,d)=>cb(e,r,d));
  }

  function runCheckin(done){
    const url = R(K.CK_URL);
    const mtd = (R(K.CK_MTD)||'GET').toUpperCase();
    const bdy = R(K.CK_BDY)||'';
    if(!url){ N('PingMe 签到','缺少 URL','请先在 App 里点一次“签到”'); done&&done(); return; }
    http(mtd,url,ua,bdy,(e,r,d)=>{
      const p=J(d)||{}; const ok=p.retcode===0; const msg=p.retmsg||p.msg||'';
      N('PingMe 签到', ok?'成功':'失败', msg|| (e?String(e):''));
      done&&done();
    });
  }

  if (MODE==='checkin'){ runCheckin(()=> $done()); }
  else if (MODE==='ad'){
    // 只做提示，不请求（避免“系统时间不准”假报）
    const ts=Number(R(K.AD_TS)||0);
    const age = ts? Math.floor((Date.now()-ts)/1000)+'s 前捕获' : '尚未捕获';
    N('PingMe 视频奖励','请手动进入 App 领取', age);
    $done();
  }
  else { runCheckin(()=> $done()); }
}