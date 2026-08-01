#!/usr/bin/env python3
"""获取 Telegram 会话字符串"""
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

api_id = int(input("请输入 TG_API_ID: "))
api_hash = input("请输入 TG_API_HASH: ")

with TelegramClient(StringSession(), api_id, api_hash) as client:
    print("\n你的会话字符串（请保存好）：")
    print(client.session.save())
