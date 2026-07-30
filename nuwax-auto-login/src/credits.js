/**
 * 积分查询模块
 *
 * 积分在「我的订阅」页 https://agent.nuwax.com/more-page/my-subscriptions
 * 结构为：
 *   <span class="credits-label___Suk6b">总积分</span>
 *   ...
 *   <span class="ant-statistic-content-value">
 *     <span class="...-value-int">2,999</span><span class="...-value-decimal">.95</span>
 *   </span>
 *
 * 以「总积分」文字为锚点定位，页面上其它 Statistic 组件（套餐用量等）不会误取。
 * /home 的 balance-text___iJON5 只有整数部分，作为锚点失效时的降级方案。
 */

const HOME_URL = 'https://agent.nuwax.com/home';
const SUBSCRIPTION_URL = 'https://agent.nuwax.com/more-page/my-subscriptions';

/**
 * 在「我的订阅」页以「总积分」标签为锚点取积分
 * @param {import('playwright').Page} page
 * @returns {Promise<string|null>} 如 "2,999.95"
 */
async function extractTotalCredits(page) {
  try {
    console.log('[credits] 打开「我的订阅」页...');
    await page.goto(SUBSCRIPTION_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    try {
      await page.waitForLoadState('networkidle', { timeout: 15000 });
    } catch (_) {}
    await page.waitForSelector('.ant-statistic-content-value', { timeout: 10000, state: 'attached' });

    const value = await page.evaluate(() => {
      // 读取 Statistic 数值：int 与 decimal 分属两个子节点，decimal 自带小数点
      const readStat = (stat) => {
        if (!stat) return null;
        const int = stat.querySelector('.ant-statistic-content-value-int')?.textContent?.trim() || '';
        const dec = stat.querySelector('.ant-statistic-content-value-decimal')?.textContent?.trim() || '';
        const text = (int + dec) || stat.textContent?.trim() || '';
        return /\d/.test(text) ? text : null;
      };

      // 找到写着「总积分」的标签，再向上找共同容器里的数值
      const label = Array.from(document.querySelectorAll('span,div,p'))
        .find((el) => el.textContent?.trim() === '总积分');

      if (label) {
        let node = label;
        // 逐级上溯，找到第一个包含 Statistic 数值的祖先
        for (let depth = 0; node && depth < 6; depth++) {
          const stat = node.querySelector?.('.ant-statistic-content-value');
          const found = readStat(stat);
          if (found) return { text: found, via: '总积分锚点' };
          node = node.parentElement;
        }
      }

      // 锚点没命中，退回页面第一个 Statistic
      const first = readStat(document.querySelector('.ant-statistic-content-value'));
      return first ? { text: first, via: '首个统计值' } : null;
    });

    if (!value) {
      console.log('[credits] 「我的订阅」页未找到积分数值');
      return null;
    }
    console.log(`[credits] 取到积分（${value.via}）：${value.text}`);
    return value.text;
  } catch (err) {
    console.warn('[credits] 「我的订阅」页取值失败:', err.message);
    return null;
  }
}

/**
 * 降级方案：从 /home 取积分（只有整数部分）
 *
 * /home 结构为 <span class="label___AFVe0">积分:</span> + 相邻数值节点，
 * 同样以文字为锚点，哈希类名仅作最后兜底。
 * @param {import('playwright').Page} page - 需已停留在 /home
 * @returns {Promise<string|null>}
 */
async function extractHomeBalance(page) {
  try {
    await page.waitForSelector('[class*="balance-text"], [class*="label"]', {
      timeout: 5000,
      state: 'attached',
    });
  } catch (_) {}

  const value = await page.evaluate(() => {
    const isNumber = (t) => t && /^[\d,]+\.?\d*$/.test(t);

    // 以「积分:」文字为锚点，在同级与父级范围内找紧随的数值
    const label = Array.from(document.querySelectorAll('span,div,p'))
      .find((el) => /^积分[:：]?$/.test(el.textContent?.trim() || ''));

    if (label) {
      // 先看紧邻的兄弟节点
      let sib = label.nextElementSibling;
      while (sib) {
        const t = sib.textContent?.trim();
        if (isNumber(t)) return { text: t, via: '积分锚点·兄弟节点' };
        sib = sib.nextElementSibling;
      }
      // 再在父级容器内扫一遍（排除锚点自身）
      let node = label.parentElement;
      for (let depth = 0; node && depth < 4; depth++) {
        const hit = Array.from(node.querySelectorAll('span,div,p'))
          .map((el) => el.textContent?.trim())
          .find(isNumber);
        if (hit) return { text: hit, via: '积分锚点·父级容器' };
        node = node.parentElement;
      }
    }

    // 锚点失效，退回哈希类名
    for (const sel of ['span.balance-text___iJON5', 'span[class*="balance-text"]', '[class*="balance"]']) {
      const t = document.querySelector(sel)?.textContent?.trim();
      if (t && /\d/.test(t)) return { text: t, via: sel };
    }
    return null;
  });

  if (value) {
    console.log(`[credits] /home 取值（${value.via}）：${value.text}`);
    return value.text;
  }
  return null;
}

/**
 * 提取积分。优先「我的订阅」页的总积分，失败降级到 /home 余额
 * @param {import('playwright').Page} page - 当前应停留在 /home
 * @returns {Promise<string|null>}
 */
export async function extractCredits(page) {
  const home = await extractHomeBalance(page);
  const total = await extractTotalCredits(page);

  if (total) return total;
  if (home) {
    console.log('[credits] 「我的订阅」页取值失败，使用 /home 整数余额');
    return home;
  }
  console.log('[credits] 未取到积分（可能未登录或页面结构已变更）');
  return null;
}

/**
 * 使用已有 BrowserContext 查询积分（登录后热调用）
 * @param {import('playwright').BrowserContext} context
 * @returns {Promise<string|null>}
 */
export async function fetchCredits(context) {
  const page = await context.newPage();
  try {
    console.log('[credits] 使用已有浏览器上下文查询积分...');
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return await extractCredits(page);
  } catch (err) {
    console.error('[credits] 查询积分异常:', err.message);
    return null;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

/**
 * 通过 Cookie 字符串启动临时浏览器查询积分
 * @param {string} cookieStr
 * @returns {Promise<string|null>}
 */
export async function fetchCreditsWithCookieViaBrowser(cookieStr) {
  const { credit } = await checkSessionAndFetchCredits(cookieStr);
  return credit;
}

/**
 * 用浏览器实地校验 Cookie 并顺带取回积分
 *
 * 以「访问 /home 后是否被弹回 /login」为判据 —— SPA 的 HTML 外壳用 fetch 判断不出登录态。
 * @param {string} cookieStr
 * @returns {Promise<{valid: boolean, credit: string|null}>}
 */
export async function checkSessionAndFetchCredits(cookieStr) {
  if (!cookieStr) return { valid: false, credit: null };
  let browser;
  try {
    const cookies = JSON.parse(cookieStr);
    if (!Array.isArray(cookies) || cookies.length === 0) {
      console.log('[credits] Cookie 格式无效或为空');
      return { valid: false, credit: null };
    }

    const { chromium } = await import('playwright');
    console.log('[credits] 启动浏览器校验 Cookie 并查询积分...');
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
    });

    await context.addCookies(cookies);
    const page = await context.newPage();
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 给 SPA 客户端路由留出跳转时间，再判断是否被弹回登录页
    await page.waitForTimeout(3000);
    if (page.url().includes('/login')) {
      console.log('[credits] Cookie 已失效（访问 /home 被弹回登录页）');
      return { valid: false, credit: null };
    }

    const credit = await extractCredits(page);
    return { valid: true, credit };
  } catch (err) {
    console.error('[credits] 浏览器校验/查询积分异常:', err.message);
    return { valid: false, credit: null };
  } finally {
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}
