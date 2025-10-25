// PingMe 自动签到（Surge 版 · 零填写）
// 用法：启用模块 → 在 App 内手点一次签到（仅首次，用于“捕获”URL/UA）→ 之后按 cron 自动执行。
// 说明：服务端若将 sign 与 signDate 强绑定，旧签名过期时本脚本会尝试仅更新 signDate 再请求一次；
// 若仍失败，则需要真实签名算法才能动态生成 sign。

const KEY_URL = 'pingme.checkin.url';
const KEY_UA  = 'pingme.checkin.ua';

// ---------- 公共工具 ----------
function nowStr() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function patchSignDate(u) {
  try {
    const enc = encodeURIComponent(nowStr()); // YYYY-MM-DD%20HH:mm:ss
    if (u.includes('signDate=')) return u.replace(/signDate=[^&]*/i, 'signDate=' + enc);
    return u + (u.includes('?') ? '&' : '?') + 'signDate=' + enc;
  } catch (_) {
    return u;
  }
}

function notify(title, sub, body) {
  try { $notification.post(title, sub || '', body || ''); } catch (_) {}
}

function httpGet(url, ua, cb) {
  const headers = {
    'Accept': 'application/json',
    'Accept-Language': 'zh-Hans;q=1.0, en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'User-Agent': ua || 'PingMe/1.9.2 (tel.pingme; build:22; iOS) Alamofire/5',
    'Host': 'api.pingmeapp.net',
  };
  $httpClient.get({ url, headers, timeout: 30 }, cb);
}

function parseResp(body, status) {
  let msg = `HTTP ${status}`;
  try {
    const data = typeof body === 'object' ? body : JSON.parse(body);
    if (data?.retcode === 0) {
      const r = data.result || {};
      const hint  = r.bonusHint || '签到成功';
      const bonus = r.bonus != null ? `+${r.bonus}` : '';
      const bal   = r.aftercredit != null ? `余额 ${r.aftercredit}` : '';
      const times = r.checkintimes != null ? `次数 ${r.checkintimes}` : '';
      msg = [hint, bonus, bal, times].filter(Boolean).join(' | ');
      notify('PingMe 签到成功', '', msg);
      return { ok: true, msg };
    } else {
      msg = `retcode=${data?.retcode} ${data?.retmsg || ''}`.trim();
      return { ok: false, msg };
    }
  } catch (e) {
    // 不是 JSON，就把原文截断显示
    return { ok: false, msg: (body || '').toString().slice(0, 300) };
  }
}

// ---------- A) 捕获并保存（http-request 阶段触发） ----------
if (typeof $request !== 'undefined') {
  try {
    const url = $request.url || '';
    const ua  = ($request.headers?.['User-Agent'] || $request.headers?.['user-agent'] || '').toString();

    if (/^https?:\/\/api\.pingmeapp\.net\/app\/checkIn\?/i.test(url)) {
      $persistentStore.write(url, KEY_URL);
      if (ua) $persistentStore.write(ua, KEY_UA);
      notify('已捕获 PingMe 签到请求', 'URL/UA 已保存', '后续将按计划自动签到');
    }
  } catch (e) {
    notify('捕获失败', '', String(e));
  }
  return $done({});
}

// ---------- B) 定时签到（cron 触发） ----------
const savedUrl = $persistentStore.read(KEY_URL) || '';
const savedUa  = $persistentStore.read(KEY_UA)  || '';

if (!savedUrl) {
  notify('PingMe 自动签到', '未捕获到签到 URL', '请先在 App 里手动点一次签到');
  return $done();
}

// 1) 先用原样 URL 请求
httpGet(savedUrl, savedUa, (e1, r1, b1) => {
  if (e1) {
    notify('PingMe 签到失败', '网络错误', String(e1));
    return $done();
  }
  const p1 = parseResp(b1, r1?.status || '');
  if (p1.ok) return $done();

  // 2) 失败则仅更新 signDate 再请求一次
  const patched = patchSignDate(savedUrl);
  if (patched === savedUrl) {
    notify('PingMe 签到失败', '无法更新 signDate', p1.msg);
    return $done();
  }

  httpGet(patched, savedUa, (e2, r2, b2) => {
    if (e2) {
      notify('PingMe 签到失败(重试)', '网络错误', String(e2));
      return $done();
    }
    const p2 = parseResp(b2, r2?.status || '');
    if (p2.ok) return $done();

    // 3) 两次都失败——大概率 sign 需算法
    notify('PingMe 签到失败', '签名可能过期/校验失败', p2.msg + ' | 需要签名算法方可自动生成 sign');
    return $done();
  });
});