// PingMe 自动签到 + 视频奖励（Surge）
// 模式：
//  mode=capture  —— 捕获 /app/checkIn 请求（保存签到 URL/UA/方法/体）
//  mode=sniff    —— 嗅探 /app/* 的响应（命中奖励类返回则保存奖励 URL/UA/方法/体；/checkIn 也会顺便保存）
//  mode=checkin  —— 定时执行“签到”
//  mode=ad       —— 定时执行“视频奖励”
//  若服务端将 sign 与 signDate 强绑定，本脚本会仅更新 signDate 再重试一次；仍失败则需要真实签名算法。

const K = {
  UA: 'pingme.ua',
  CK_URL: 'pingme.checkin.url',
  CK_MTD: 'pingme.checkin.method',
  CK_BDY: 'pingme.checkin.body',
  AD_URL: 'pingme.ad.url',
  AD_MTD: 'pingme.ad.method',
  AD_BDY: 'pingme.ad.body',
};

const ARG = (typeof $argument === 'string' && $argument) ? Object.fromEntries(
  $argument.split('&').map(s => {
    const i = s.indexOf('=');
    return i > -1 ? [s.slice(0, i), decodeURIComponent(s.slice(i + 1))] : [s, '1'];
  })
) : {};

function nowStr() {
  const d = new Date(), p = n => n < 10 ? '0' + n : '' + n;
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function patchSignDate(u) {
  try {
    const enc = encodeURIComponent(nowStr());
    return u.includes('signDate=') ? u.replace(/signDate=[^&]*/i, 'signDate=' + enc)
                                   : u + (u.includes('?') ? '&' : '?') + 'signDate=' + enc;
  } catch { return u; }
}
function notify(t, s, b) { try { $notification.post(t, s || '', b || ''); } catch {} }
function save(k, v) { $persistentStore.write(v, k); }
function read(k) { return $persistentStore.read(k) || ''; }

function requestOnce({ url, method, body, ua }, cb) {
  const headers = {
    'Accept': 'application/json',
    'Accept-Language': 'zh-Hans;q=1.0, en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'User-Agent': ua || 'PingMe/1.9.2 (tel.pingme; iOS) Alamofire/5',
    'Host': 'api.pingmeapp.net',
  };
  const req = { url, headers, timeout: 30 };
  if ((method || 'GET').toUpperCase() === 'POST') {
    req.body = body || '';
    req.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  ((method || 'GET').toUpperCase() === 'POST' ? $httpClient.post : $httpClient.get)(req, cb);
}

function parseBody(body, status) {
  try {
    const d = typeof body === 'object' ? body : JSON.parse(body);
    if (d?.retcode === 0) {
      const r = d.result || {};
      const parts = [
        r.bonusHint || '成功',
        r.bonus != null ? `+${r.bonus}` : '',
        r.aftercredit != null ? `余额 ${r.aftercredit}` : '',
        r.checkintimes != null ? `次数 ${r.checkintimes}` : '',
      ].filter(Boolean);
      return { ok: true, msg: parts.join(' | ') };
    } else {
      return { ok: false, msg: `retcode=${d?.retcode} ${d?.retmsg || ''}`.trim() };
    }
  } catch {
    return { ok: false, msg: (body || '').toString().slice(0, 300) };
  }
}

function stash(type, req) {
  const ua = (req.headers?.['User-Agent'] || req.headers?.['user-agent'] || '').toString();
  if (ua) save(K.UA, ua);

  const m = (req.method || 'GET').toUpperCase();
  const u = req.url || '';
  const b = (typeof req.body === 'string') ? req.body : '';

  if (type === 'checkin') {
    save(K.CK_URL, u); save(K.CK_MTD, m); if (m !== 'GET') save(K.CK_BDY, b);
    notify('已捕获签到接口', '', u);
  } else if (type === 'ad') {
    save(K.AD_URL, u); save(K.AD_MTD, m); if (m !== 'GET') save(K.AD_BDY, b);
    notify('已捕获视频奖励接口', '', u);
  }
}

function classify(url, bodyText) {
  if (/\/app\/checkIn\?/i.test(url)) return 'checkin';
  try {
    const data = JSON.parse(bodyText || '{}');
    const r = data.result || {};
    const hint = (r.bonusHint || '').toString();
    const looksReward = data.retcode === 0 && (hint.includes('广告') || hint.includes('观看') || r.bonus != null) && !/checkIn/i.test(url);
    if (looksReward) return 'ad';
  } catch {}
  return '';
}

function runOne(kind) {
  const ua = read(K.UA);
  const url = kind === 'checkin' ? read(K.CK_URL) : read(K.AD_URL);
  const mtd = (kind === 'checkin' ? read(K.CK_MTD) : read(K.AD_MTD)) || 'GET';
  const bdy = kind === 'checkin' ? read(K.CK_BDY) : read(K.AD_BDY);

  if (!url) {
    notify('PingMe 任务未捕获', kind === 'checkin' ? '缺少“签到”URL' : '缺少“视频奖励”URL', '请先在 App 内各执行一次以捕获。');
    return $done();
  }

  // 1) 原样请求
  requestOnce({ url, method: mtd, body: bdy, ua }, (e1, r1, body1) => {
    if (e1) { notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, '网络错误', String(e1)); return $done(); }
    const p1 = parseBody(body1, r1?.status || '');
    if (p1.ok) { notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, '成功', p1.msg); return $done(); }

    // 2) 仅更新 signDate 再试（GET）
    if (mtd !== 'GET') { notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, '失败（POST不改signDate）', p1.msg); return $done(); }
    const patched = patchSignDate(url);
    requestOnce({ url: patched, method: 'GET', ua }, (e2, r2, body2) => {
      if (e2) { notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, '网络错误(重试)', String(e2)); return $done(); }
      const p2 = parseBody(body2, r2?.status || '');
      notify(`PingMe ${kind==='checkin'?'签到':'视频奖励'}`, p2.ok ? '成功(重试)' : '失败', p2.msg);
      return $done();
    });
  });
}

// ===== 入口 =====
const mode = (ARG.mode || '').toLowerCase();

// A) 捕获：请求阶段（/checkIn）
if (mode === 'capture' && typeof $request !== 'undefined') {
  if (/^https?:\/\/api\.pingmeapp\.net\/app\/checkIn\?/i.test($request.url || '')) stash('checkin', $request);
  return $done({});
}

// B) 嗅探：响应阶段（奖励/签到都可抓）
if (mode === 'sniff' && typeof $response !== 'undefined') {
  const url = $request?.url || '';
  if (!/^https?:\/\/api\.pingmeapp\.net\/app\//i.test(url)) return $done({});
  const ctype = ($response.headers?.['Content-Type'] || $response.headers?.['content-type'] || '').toString();
  const bodyText = typeof $response.body === 'string' ? $response.body : '';
  if (!ctype.includes('application/json') && !/^\s*[{[]/.test(bodyText || '')) return $done({});
  const which = classify(url, bodyText);
  if (which) stash(which, $request);
  return $done({});
}

// C) 定时：签到 / 奖励
if (mode === 'checkin')  return runOne('checkin');
if (mode === 'ad')       return runOne('ad');

$done();