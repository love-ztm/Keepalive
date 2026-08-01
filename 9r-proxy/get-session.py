#!/usr/bin/env python3
"""获取 Telegram 会话字符串"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

API_ID = 39935554
API_HASH = "925db1ff5daa3437a6a5ca5c202fadff"

proxy = ('socks5', '127.0.0.1', 10808, True, None, None)

with TelegramClient(StringSession(), API_ID, API_HASH, proxy=proxy) as client:
    print("\n" + "="*50)
    print("你的会话字符串（请保存好）：")
    print("="*50)
    print(client.session.save())
    print("="*50)
