#!/usr/bin/env python3
"""Minimal CDP client for driving/inspecting the Auralis Electron app.

Usage:
  cdp.py pages                        list debug targets
  cdp.py eval <substr> <js-expr>      evaluate JS in matching target (returns JSON value)
  cdp.py shot <substr> <file.png>     screenshot matching target
"""
import base64
import json
import sys
import urllib.request

import websocket

PORT = 9222


def targets():
    return json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list"))


def pick(substr):
    matches = [t for t in targets() if substr in (t.get("url") or "") + (t.get("title") or "")]
    if not matches:
        print(json.dumps({"error": f"no target matching {substr!r}",
                          "have": [(t.get("type"), t.get("url"), t.get("title")) for t in targets()]}))
        sys.exit(1)
    return matches[0]


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=30)
        self.mid = 0

    def cmd(self, method, **params):
        self.mid += 1
        self.ws.send(json.dumps({"id": self.mid, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.mid:
                return msg

    def eval_js(self, expr):
        r = self.cmd("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        res = r.get("result", {})
        if res.get("exceptionDetails"):
            return {"__exception": res["exceptionDetails"].get("exception", {}).get("description")
                    or res["exceptionDetails"].get("text")}
        return res.get("result", {}).get("value")

    def shot(self, path):
        r = self.cmd("Page.captureScreenshot", format="png")
        data = r.get("result", {}).get("data")
        if not data:
            print(json.dumps({"error": r}))
            sys.exit(1)
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path


def main():
    cmd = sys.argv[1]
    if cmd == "pages":
        for t in targets():
            print(t.get("type"), "|", t.get("url")[:100], "|", t.get("title")[:60])
        return
    arg = sys.argv[2]
    t = pick(arg)
    c = CDP(t["webSocketDebuggerUrl"])
    if cmd == "eval":
        print(json.dumps(c.eval_js(sys.argv[3]), indent=None, default=str))
    elif cmd == "shot":
        print(c.shot(sys.argv[3]))


if __name__ == "__main__":
    main()
