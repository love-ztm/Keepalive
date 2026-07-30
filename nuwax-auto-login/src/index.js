/**
 * nuwax-auto-login 主入口
 *
 * 流程：
 * 1. 从环境变量读取已保存的 Cookie
 * 2. 校验 Cookie 有效性
 * 3. 有效 → 跳过登录，直接查询积分
 * 4. 无效 → Playwright 自动登录 → 查询积分
 * 5. 登录成功 → 将 Cookie 写入 GitHub Variable
 * 6. TG 通知结果（含积分数据）
 */
import { readCookieFromEnv, saveCookieToVariable } from './cookie.js';
import { doLogin } from './login.js';
import { fetchCredits, fetchCreditsWithCookieViaBrowser, checkSessionAndFetchCredits } from './credits.js';
import { sendNotify } from './notify.js';

async function main() {
  console.log('=== nuwax-auto-login ===');
  console.log(`时间: ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);

  const debug = process.argv.includes('--debug');
  const phone = process.env.NUWAX_PHONE;
  const password = process.env.NUWAX_PASSWORD;

  if (!phone || !password) {
    console.error('缺少 NUWAX_PHONE 或 NUWAX_PASSWORD 环境变量');
    await sendNotify({
      status: 'fail',
      message: '缺少必要的环境变量（NUWAX_PHONE / NUWAX_PASSWORD）',
    });
    process.exit(1);
  }

  // 步骤 1: 读取已保存的 Cookie
  const savedCookie = readCookieFromEnv();

  let needLogin = true;
  let cookieStr = savedCookie;
  let credit = null;

  // 步骤 2: 如果有 Cookie，用浏览器实地校验并顺带取回积分
  // （SPA 的 HTML 外壳无法用 fetch 判断登录态，必须看 /home 是否被弹回 /login）
  if (savedCookie) {
    console.log('[main] 检测到已保存的 Cookie，正在校验...');
    const session = await checkSessionAndFetchCredits(savedCookie);
    if (session.valid) {
      console.log('[main] Cookie 有效，跳过登录');
      needLogin = false;
      credit = session.credit;
    } else {
      console.log('[main] Cookie 已过期，需要重新登录');
    }
  } else {
    console.log('[main] 无已保存的 Cookie，需要登录');
  }

  let loginSuccess = false;
  // null 表示本次没走写回（Cookie 仍有效），非 null 时为 { ok, error }
  let cookieSaved = null;

  if (needLogin) {
    console.log('[main] 开始执行自动化登录...');
    const result = await doLogin({ phone, password, debug });

    if (result.success && result.cookies) {
      console.log('[main] 登录成功');
      cookieStr = result.cookies;
      loginSuccess = true;

      // 查询积分（复用登录后的浏览器上下文）
      if (result.context) {
        credit = await fetchCredits(result.context);
        try {
          const browser = result.context.browser();
          if (browser) await browser.close();
          console.log('[login] 浏览器已关闭');
        } catch (_) {}
      } else {
        credit = await fetchCreditsWithCookieViaBrowser(cookieStr);
      }

      // 保存 Cookie 到 GitHub Variable
      cookieSaved = await saveCookieToVariable(cookieStr);
    } else {
      console.error('[main] 登录失败');
      await sendNotify({
        status: 'fail',
        message: result.reason || '自动登录失败，滑块验证未通过或页面异常',
        screenshotUrl: result.screenshotPath,
      });
      process.exit(1);
    }
  } else {
    loginSuccess = true;
  }

  // TG 通知
  if (loginSuccess) {
    const msg = needLogin ? '已重新登录并续期 Cookie' : 'Cookie 有效，跳过登录';
    await sendNotify({
      status: 'success',
      message: msg,
      credit,
      cookieSaved,
    });
  }

  console.log('[main] 流程完成');
}

main().catch(async (err) => {
  console.error('[main] 未捕获异常:', err);
  try {
    await sendNotify({
      status: 'fail',
      message: `脚本异常: ${err.message}`,
    });
  } catch (_) {}
  process.exit(1);
});