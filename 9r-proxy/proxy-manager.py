#!/usr/bin/env python3
"""
9router 代理池同步脚本

从上游仓库下载 socks5-otc.txt，同步到 9router：
1. 下载上游 socks5-otc.txt（已筛选的节点）
2. 同步到 9Router（只增不减）
3. 输出最终节点到 socks5-otc.txt
"""

import os
import re
import sys
import json
import base64
import logging
from datetime import datetime, timezone, timedelta
import requests

# 上游 socks5-otc.txt 地址
UPSTREAM_URL = "https://raw.githubusercontent.com/yutian81/Keepalive/main/9r-proxy/socks5-otc.txt"

BASE_URL = os.getenv("9R_BASE_URL") or "https://9r.l.cd"
PASSWORD = os.getenv("R9_PASSWORD") or ""
COOKIE_B64 = os.getenv("R9_COOKIE") or ""
COOKIE_FILE = "cookies.txt"
OUTPUT_FILE = "socks5-otc.txt"
TYPE_ALLOWED = {"socks5", "http", "https"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger("proxy-manager")

# ================= 上游节点下载 =================

def download_nodes() -> list:
    log.info("下载上游节点: %s", UPSTREAM_URL)
    try:
        resp = requests.get(UPSTREAM_URL, timeout=30)
        resp.raise_for_status()
        lines = resp.text.strip().split("\n")
        nodes = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            parsed = parse_node(line)
            if parsed:
                nodes.append({"url": line, "name": parsed[3]})
        log.info("下载完成: %d 个节点", len(nodes))
        return nodes
    except Exception as e:
        log.error("下载上游节点失败: %s", e)
        return []

# ================= Cookie 管理 =================

def cookie_b64_to_jar(b64: str) -> list:
    try:
        raw = base64.b64decode(b64).decode("utf-8")
        data = json.loads(raw)
        if isinstance(data, dict):
            return [{"name": k, "value": v, "domain": "", "path": "/"} for k, v in data.items()]
        return data if isinstance(data, list) else []
    except Exception:
        return []

def cookie_jar_to_b64(cookies: list) -> str:
    return base64.b64encode(json.dumps(cookies).encode("utf-8")).decode("utf-8")

def load_cookie_jar() -> list:
    if COOKIE_B64:
        return cookie_b64_to_jar(COOKIE_B64)
    if os.path.exists(COOKIE_FILE):
        with open(COOKIE_FILE, "r", encoding="utf-8") as f:
            return cookie_b64_to_jar(f.read().strip())
    return []

def save_cookie_jar(cookies: list):
    with open(COOKIE_FILE, "w", encoding="utf-8") as f:
        f.write(cookie_jar_to_b64(cookies))

def make_session(cookies: list) -> requests.Session:
    s = requests.Session()
    for c in cookies:
        s.cookies.set(
            c.get("name"), c.get("value"),
            domain=c.get("domain") or "",
            path=c.get("path") or "/",
            secure=c.get("secure") or False,
        )
    s.headers.update({"Content-Type": "application/json"})
    return s

# ================= 9router API =================

def api_login(session: requests.Session) -> bool:
    try:
        resp = session.post(f"{BASE_URL}/api/auth/login", json={"password": PASSWORD}, timeout=15)
        data = resp.json()
        if data.get("success"):
            log.info("9router 登录成功")
            return True
        log.error("9router 登录失败: %s", data.get("message"))
        return False
    except requests.RequestException as e:
        log.error("登录异常: %s", e)
        return False

def api_get_pools(session: requests.Session) -> list:
    try:
        resp = session.get(f"{BASE_URL}/api/proxy-pools", timeout=15)
        data = resp.json()
        pools = data.get("proxyPools") if isinstance(data, dict) else None
        return pools if isinstance(pools, list) else []
    except Exception as e:
        log.error("获取代理池异常: %s", e)
        return []

def api_add_pool(session: requests.Session, name: str, proxy_url: str) -> bool:
    payload = {
        "name": name,
        "proxyUrl": proxy_url,
        "type": "http",
        "isActive": True,
        "strictProxy": False,
    }
    try:
        resp = session.post(f"{BASE_URL}/api/proxy-pools", json=payload, timeout=15)
        return resp.status_code in (200, 201)
    except Exception as e:
        log.error("新增代理池异常: %s", e)
        return False

# ================= 工具函数 =================

NODE_RE = re.compile(r"(socks5|http|https)://[^\s#@]+@(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)")

def parse_node(url: str) -> tuple:
    m = NODE_RE.match(url)
    if not m:
        return None
    scheme, ip, port = m.group(1), m.group(2), m.group(3)
    return scheme, ip, port, f"{ip}:{port}"

def is_type_allowed(pool_type: str) -> bool:
    return (pool_type or "").lower() in TYPE_ALLOWED

def extract_name(proxy_url: str) -> str:
    parsed = parse_node(proxy_url)
    return parsed[3] if parsed else proxy_url

# ================= 主流程 =================

def main():
    if not PASSWORD:
        log.error("未配置 R9_PASSWORD，退出")
        sys.exit(1)

    log.info("=" * 48)
    log.info("9router 代理池同步启动")

    stats = {"fetched": 0, "added": 0, "total": 0}

    # 1. 下载上游节点
    new_nodes = download_nodes()
    stats["fetched"] = len(new_nodes)
    if not new_nodes:
        log.error("未获取到节点，退出")
        sys.exit(1)

    # 2. 登录 9Router
    session = make_session(load_cookie_jar())
    pools = api_get_pools(session)
    if not pools and not api_login(session):
        log.error("登录失败，退出")
        sys.exit(1)
    if not pools:
        pools = api_get_pools(session)

    # 3. 构建现有池
    existing = {}
    for p in pools:
        ptype = p.get("type", "")
        if is_type_allowed(ptype):
            name = p.get("name") or extract_name(p.get("proxyUrl", ""))
            existing.setdefault(name, p)
    log.info("现有代理池: %d 个", len(existing))

    # 4. 只增不减
    for node in new_nodes:
        name = node["name"]
        if name not in existing:
            if api_add_pool(session, name, node["url"]):
                stats["added"] += 1
                log.info("新增: %s", node["url"][:50])

    # 5. 获取最终列表
    pools = api_get_pools(session)
    final = [p for p in pools if is_type_allowed(p.get("type", ""))]

    # 6. 写入文件
    stats["total"] = len(final)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        for p in final:
            f.write(p.get("proxyUrl", "") + "\n")
    log.info("最终 %d 个节点，已写入 %s", stats["total"], OUTPUT_FILE)

    # 7. 保存 cookie
    cookie_list = [
        {"name": c.name, "value": c.value, "domain": c.domain,
         "path": c.path, "secure": c.secure}
        for c in session.cookies
    ]
    if cookie_list:
        save_cookie_jar(cookie_list)

    # 8. TG 通知
    token = os.getenv("TG_BOT_TOKEN") or ""
    chat_id = os.getenv("TG_CHAT_ID") or ""
    if token and chat_id:
        bjt = datetime.now(timezone(timedelta(hours=8)))
        msg = (
            f"🎉 <b>9Router 同步完成</b>\n"
            f"📅 {bjt.year}年{bjt.month:02d}月{bjt.day:02d}日\n"
            f"📥 上游: {stats['fetched']} 个\n"
            f"➕ 新增: {stats['added']} 个\n"
            f"✅ 总计: {stats['total']} 个"
        )
        try:
            requests.post(f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": msg, "parse_mode": "HTML"}, timeout=15)
        except:
            pass

    log.info("同步完成: 上游 %d, 新增 %d, 总计 %d",
             stats["fetched"], stats["added"], stats["total"])


if __name__ == "__main__":
    main()
