#!/usr/bin/env python3
# 页面取数证据：司机 EV04（my.score）与管理员 EV01 列表值 = 数据库值
import json, time, urllib.request

B = "http://127.0.0.1:3000"
kv = dict(l.split("=", 1) for l in open("/tmp/qwenwork/app.env").read().split("\n") if "=" in l)

def req(path, data=None, ck=None):
    r = urllib.request.Request(B + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"content-type": "application/json", **({"cookie": ck} if ck else {})},
        method="POST" if data is not None else "GET")
    try:
        resp = urllib.request.urlopen(r, timeout=5)
    except urllib.error.HTTPError as e:
        body = json.loads(e.read() or b"{}")
        return e.code, body, ck
    ckv = "".join(x.split(";")[0] for x in (resp.headers.get_all("Set-Cookie") or []) if "claw_session" in x)
    body = json.loads(resp.read() or b"{}")
    return resp.status, body, (ckv or ck)

# 司机登录 → 读自己首页真实渲染数据
st, _, dck = req("/api/auth/login", {"username": "driver_demo", "password": kv["DRIVER_PW"]})
st2, me, _ = req("/api/me", ck=dck)
u = me["user"]
print("DRIVER /api/me: role=", u["role"], "driverId=", u["driverId"], "verified=", u["bindingVerified"])
print("  watermark:", u["bindingNote"])
st3, sc, _ = req("/api/data/my.score?limit=5", ck=dck)
row = sc["rows"][0]
print(f"DRIVER EV04 my.score → HTTP {st3}, rows={len(sc['rows'])}")
for k in ["score_id", "safety_score", "rank", "risk_level", "confidence_score", "confidence_level",
          "score_change_7d", "as_of_date", "window_start", "primary_risk_dimension", "forecast_40d_risk_prob", "source_version"]:
    print("   ", k, "=", row.get(k))
print("  六维:", {k: row.get(k) for k in sc["rows"][0] if k.endswith("_contribution") or k in (
  "history_contribution","fatigue_distraction_contribution","driving_stability_contribution",
  "road_rule_contribution","management_contribution","imu_evidence_contribution")})
# 越权尝试（同一司机会话）
for path in ["/api/data/admin.score_snapshots?limit=50", "/api/data/admin.drivers?limit=50", "/api/overview"]:
    st4, j4, _ = req(path, ck=dck)
    print(f"DRIVER 越权 {path} → HTTP {st4} {j4.get('error','')}")

# 管理员登录 → EV01/RM 队列
st5, _, ack = req("/api/auth/login", {"username": "safety_admin", "password": kv["ADMIN_PW"]})
st6, ov, _ = req("/api/overview", ck=ack)
m = {x["key"]: x["count"] for x in ov["metrics"]}
print("ADMIN overview:", "drivers=", m["drivers"], "score_latest=", m["score_latest"], "low_confidence=", m["low_confidence"], "as_of=", ov["asOfDate"], "imported=", ov["dataImported"])
st7, lst, _ = req("/api/data/admin.score_snapshots?limit=50", ck=ack)
print("ADMIN EV01 rows=", len(lst["rows"]), "ids=", [r["driver_id"] for r in lst["rows"]])
q = [r for r in lst["rows"] if r["confidence_level"] == "low"]
print("  低可信度(页面琥珀+先核验提示适用):", [(r["driver_id"], r["confidence_level"]) for r in q])
st8, rk, _ = req("/api/data/admin.risk_snapshots?limit=50", ck=ack)
print("ADMIN risk rows=", len(rk["rows"]), [(r["snapshot_id"], r["risk_prob"], r["risk_rank"]) for r in rk["rows"]])
# 司机不可见他对象
st9, ev4, _ = req("/api/data/my.score_history?limit=50", ck=dck)
print("DRIVER my.score_history →", st9, "rows=", len(ev4.get("rows", [])))
