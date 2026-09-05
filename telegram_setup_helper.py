import json
import os
import time
import urllib.request


token = os.environ["TELEGRAM_BOT_TOKEN"]
deadline = time.monotonic() + 300
payload = {"ok": True, "result": []}

while time.monotonic() < deadline:
    with urllib.request.urlopen(
        f"https://api.telegram.org/bot{token}/getUpdates", timeout=30
    ) as response:
        payload = json.load(response)
    if payload.get("result"):
        break
    time.sleep(5)

print(json.dumps(payload, ensure_ascii=False))
