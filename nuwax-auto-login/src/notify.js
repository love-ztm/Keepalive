/**
 * Telegram 通知模块
 * 通过 TG Bot API 发送登录结果通知
 */

/**
 * 手机号脱敏：138****8888
 * @param {string} phone
 * @returns {string}
 */
function maskPhone(phone) {
  if (!phone) return '*****';
  if (phone.length < 7) return phone.slice(0, 2) + '*****';
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

/**
 * 发送 TG 通知
 * @param {object} options
 * @param {string} options.status - 'success' | 'fail'
 * @param {string} options.message - 消息内容
 * @param {string} [options.credit] - 积分值（可选）
 * @param {object|null} [options.cookieSaved] - 写回结果 { ok, error }，null 表示未执行写回
 * @param {string} [options.screenshotUrl] - 截图路径（可选）
 */
export async function sendNotify({ status, message, credit, cookieSaved, screenshotUrl }) {
  const botToken = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;

  if (!botToken || !chatId) {
    console.warn('[notify] TG_BOT_TOKEN 或 TG_CHAT_ID 未设置，跳过通知');
    return;
  }

  const emoji = status === 'success' ? '✅' : '❌';
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const account = maskPhone(process.env.NUWAX_PHONE);

  let text = `${emoji} nuwax 自动登录${status === 'success' ? '成功' : '失败'}\n`;
  text += `━━━━━━━━━━━━━━━━\n`;
  text += `🕐 时间: ${now}\n`;
  text += `👤 账号: ${account}\n`;
  text += `📋 状态: ${message}\n`;

  // 积分行始终输出，缺失时显式提示，避免"静默消失"让人以为没跑
  if (credit) {
    text += `💰 积分: ${credit}\n`;
  } else if (status === 'success') {
    text += `⚠️ 积分: 获取失败（页面结构可能已变更）\n`;
  }

  // Cookie 写回失败必须显式告知：否则下次仍会重新登录，而通知看起来一切正常
  if (cookieSaved && !cookieSaved.ok) {
    text += `⚠️ Cookie 写回失败: ${cookieSaved.error}\n`;
    text += `   下次运行将重新登录，请检查 GH_TOKEN 权限\n`;
  }

  if (screenshotUrl) {
    text += `📸 截图: 已上传至 Actions Artifacts（${screenshotUrl}）`;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error('[notify] TG 发送失败:', data);
    } else {
      console.log('[notify] TG 通知已发送');
    }
  } catch (err) {
    console.error('[notify] TG 通知异常:', err.message);
  }
}
