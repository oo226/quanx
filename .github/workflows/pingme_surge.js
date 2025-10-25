// PingMe 自动签到 + 视频奖励（Surge）· 可在“脚本编辑器”直接跑测试
// 触发模式：
//  - mode=capture  ：请求阶段捕获 /app/checkIn 与 /app/videoBonus
//  - mode=sniff    ：响应阶段嗅探任意 /app/*，命中奖励 JSON 或 /checkIn 即保存
//  - mode=checkin  ：只跑签到
//  - mode=ad       ：只跑广告奖励
//  - 【编辑器直接运行】无参数时自动：若同时捕获到两条URL → 先签到再广告；
//    只捕获到一条则只跑那一条；都没捕获则发通知提示去 App 里先操作一次。

(() => {
  const K = {
    UA: 'pingme.ua',
    CK_URL: 'pingme.checkin.url', CK_MTD: 'pingme.checkin.method', CK_BDY: 'pingme.checkin.body',
    AD_URL: 'pingme.ad.url',      AD_MTD: 'pingme.ad.method',     AD_BDY: 'pingme.ad.body',
  };

  const ARG = (typeof $argument === 'string' && $argument) ? Object.fromEntries(
    $argument.split('&').map(s => { const i=s.indexOf('='); return i>-1?[s.slice(0,i),decodeURIComponent(s.slice(i+1))]:[s,'1']; })
  ) : {};

  function nowStr(){const d=new Date(),p=n=>n<10?'0'+n:''+n;return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;}
  function patchSignDate(u){try{const enc=encodeURIComponent(nowStr());return u.includes('signDate=')?u.replace(/signDate=[^&]*/i,'signDate='+enc):u+(u.includes('?')?'&':'?')+'signDate='+enc;}catch{return u;}}
  function notify(t,s,b){try{$notification.post(t,s||'',b||'');}catch{}}
  function save(k,v){$persistentStore.write(v,k);} function read(k){return $persistentStore.read(k)||'';}

  function requestOnce({url,method,body,ua},cb){
    const headers={'Accept':'application/json','Accept-Language':'zh-Hans;q=1.0, en;q=0.9','Accept-Encoding':'gzip, deflate, br','Connection':'keep-alive','User-Agent':ua||'PingMe/1.9.2 (tel.pingme; iOS) Alamofire/5','Host':'api.pingmeapp.net'};
    const req={url,headers,timeout:30};
    const M=(method||'GET').toUpperCase();
    if(M==='POST'){ req.body=body||''; req.headers['Content-Type']='application/x-www-form-urlencoded'; }
    (M==='POST'?$httpClient.post:$httpClient.get)(req,cb);
  }
  function parseBody(body,status){
    try{
      const d=typeof body==='object'?body:JSON.parse(body);
      if(d?.retcode===0){
        const r=d.result||{};
        const parts=[r.bonusHint||'成功', r.bonus!=null?`+${r.bonus}`:'', r.aftercredit!=null?`余额 ${r.aftercredit}`:'', r.checkintimes!=null?`次数 ${r.checkintimes}`:''].filter(Boolean);
        return {ok:true,msg:parts.join(' | ')};
      }
      return {ok:false,msg:`retcode=${d?.retcode} ${d?.retmsg||''}`.trim()};
    }catch{ return {ok:false,msg:(body||'').toString().slice(0,300)}; }
  }
  function stash(type, req){
    const ua=(req.headers?.['User-Agent']||req.headers?.['user-agent']||'').toString(); if(ua) save(K.UA,ua);
    const m=(req.method||'GET').toUpperCase(), u=req.url||'', b=(typeof req.body==='string')?req.body:'';
    if(type==='checkin'){ save(K.CK_URL,u); save(K.CK_MTD,m); if(m!=='GET') save(K.CK_BDY,b); notify('已捕获签到接口','',u); }
    if(type==='ad'){      save(K.AD_URL,u);  save(K.AD_MTD,m);  if(m!=='GET') save(K.AD_BDY,b);  notify('已捕获视频奖励接口','',u); }
  }
  function classify(url, bodyText){
    if(/\/app\/checkIn\?/i.test(url)) return 'checkin';
    try{ const d=JSON.parse(bodyText||'{}'), r=d.result||{}, hint=(r.bonusHint||'').toString();
         if(d.retcode===0 && (hint.includes('广告')||hint.includes('观看')||r.bonus!=null) && !/checkIn/i.test(url)) return 'ad';
    }catch{}
    return '';
  }

  // —— A) 捕获（请求阶段）：/checkIn 与 /videoBonus —— //
  if (ARG.mode==='capture' && typeof $request!=='undefined'){
    const u=$request.url||'';
    if (/\/app\/checkIn\?/i.test(u)) stash('checkin',$request);
    else if (/\/app\/videoBonus\?/i.test(u)) stash('ad',$request);
    $done({}); return;
  }

  // —— B) 嗅探（响应阶段）：奖励/签到都可抓 —— //
  if (ARG.mode==='sniff' && typeof $response!=='undefined'){
    const url=$request?.url||''; if(!/^https?:\/\/api\.pingmeapp\.net\/app\//i.test(url)){ $done({}); return; }
    const ctype=($response.headers?.['Content-Type']||$response.headers?.['content-type']||'').toString();
    const bodyText=typeof $response.body==='string'?$response.body:'';
    if(!ctype.includes('application/json') && !/^\s*[{[]/.test(bodyText||'')){ $done({}); return; }
    const which=classify(url, bodyText); if(which) stash(which,$request);
    $done({}); return;
  }

  // —— C) 定时/手动执行 —— //
  function runOne(kind, cb){
    const ua=read(K.UA);
    const url=kind==='checkin'?read(K.CK_URL):read(K.AD_URL);
    const mtd=(kind==='checkin'?read(K.CK_MTD):read(K.AD_MTD))||'GET';
    const bdy=kind==='checkin'?read(K.CK_BDY):read(K.AD_BDY);

    if(!url){ notify('PingMe 任务未捕获', kind==='checkin'?'缺少“签到”URL':'缺少“视频奖励”URL','请先在 App 内各操作一次'); cb(); return; }

    requestOnce({url,method:mtd,body:bdy,ua},(e1,r1,b1)=>{
      if(e1){ notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`,'网络错误',String(e1)); cb(); return; }
      const p1=parseBody(b1,r1?.status||''); if(p1.ok){ notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`,'成功',p1.msg); cb(); return; }
      if(mtd!=='GET'){ notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`,'失败（POST不改signDate）',p1.msg); cb(); return; }
      const patched=patchSignDate(url);
      requestOnce({url:patched,method:'GET',ua},(e2,r2,b2)=>{
        if(e2){ notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`,'网络错误(重试)',String(e2)); cb(); return; }
        const p2=parseBody(b2,r2?.status||''); notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, p2.ok?'成功(重试)':'失败', p2.msg); cb();
      });
    });
  }

  // —— 入口选择 —— //
  const runningManually = (typeof $request === 'undefined' && typeof $response === 'undefined');
  const mode = (ARG.mode || (runningManually ? 'test' : '')).toLowerCase();

  if (mode === 'checkin'){ runOne('checkin', ()=> $done()); return; }
  if (mode === 'ad'){      runOne('ad',      ()=> $done()); return; }

  // 手动测试：先签到后广告；按捕获情况自动跳过缺失项
  if (mode === 'test'){
    const hasCk = !!read(K.CK_URL);
    const hasAd = !!read(K.AD_URL);
    if (!hasCk && !hasAd){
      notify('PingMe 测试','没有可用的URL','请先在 App 里点一次签到并看一次广告领奖'); $done(); return;
    }
    if (hasCk){
      runOne('checkin', ()=>{
        if (hasAd) runOne('ad', ()=> $done());
        else $done();
      });
    } else {
      runOne('ad', ()=> $done());
    }
    return;
  }

  // 其它情况（既不是请求/响应触发，也没指定模式）
  $done();
})();