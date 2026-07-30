/**
 * Cookie 持久化模块
 * 从环境变量 $NUWAX_COOKIE 读取，写回 GitHub Repository Variable
 */
import { execSync } from 'child_process';

/**
 * 从环境变量读取 Cookie
 * @returns {string|null} Cookie JSON 字符串或 null
 */
export function readCookieFromEnv() {
  const cookieStr = process.env.NUWAX_COOKIE;
  if (!cookieStr || cookieStr === '' || cookieStr === 'undefined') {
    console.log('[cookie] 环境变量中未找到 Cookie');
    return null;
  }
  console.log('[cookie] 从环境变量读取到 Cookie');
  return cookieStr;
}

/**
 * 使用 gh CLI 将 Cookie 写入 GitHub Repository Variable
 */
export async function saveCookieToVariable(cookieStr) {
  if (!cookieStr) {
    console.warn('[cookie] Cookie 为空，跳过保存');
    return { ok: false, error: 'Cookie 为空' };
  }

  if (!process.env.GH_TOKEN) {
    console.error('[cookie] 未配置 GH_TOKEN，无法写入 Variable');
    return { ok: false, error: '未配置 GH_TOKEN' };
  }

  // 对特殊字符做转义，避免 shell 解析问题
  const escaped = cookieStr.replace(/'/g, "'\\''");
  const cmd = `gh variable set NUWAX_COOKIE --body '${escaped}'`;
  console.log('[cookie] 正在写入 GitHub Variable...');
  try {
    execSync(cmd, { stdio: 'pipe', timeout: 30000 });
    console.log('[cookie] GitHub Variable 写入成功');
    return { ok: true, error: null };
  } catch (err) {
    const detail = (err.stderr?.toString() || '').trim() || err.message;
    console.error('[cookie] 写入 GitHub Variable 失败:', detail);
    return { ok: false, error: detail };
  }
}