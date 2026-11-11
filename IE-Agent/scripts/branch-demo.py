#!/usr/bin/env python3
import json, urllib.request, traceback
kv=dict(l.split("=",1) for l in open("/tmp/qwenwork/app.env").read().split("\n") if "=" in l)
def call(path, method="GET", body=None, ck=None):
    r=urllib.request.Request("http://127.0.0.1:3000"+path, data=json.dumps(body).encode() if body is not None else None,
      headers={"content-type":"application/json", **({"cookie":ck} if ck else {})}, method=method)
    try:
        resp=urllib.request.urlopen(r,timeout=60); sc=";".join(x.split(";")[0] for x in (resp.headers.get_all("Set-Cookie") or []) if "claw_session" in x)
        return resp.status, json.loads(resp.read() or b"{}"), (sc or ck)
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}"), ck
        except Exception: return e.code, {}, ck
try:
    _,_,A=call("/api/auth/login","POST",{"username":"safety_admin","password":kv["ADMIN_PW"]})
    _,_,D=call("/api/auth/login","POST",{"username":"driver_demo","password":kv["DRIVER_PW"]})
    def show(n,*r): print(n, r[0], json.dumps(r[1],ensure_ascii=False)[:200])
    # R链: 新演示任务(自定义幂等)→start→提交不合格→returned→补草稿→再交→通过
    st,j,_=call("/api/admin/training-assign","POST",{"course_id":"DEMO_C01","driver_id":"DEMO_D0149","goal":"分支演示：returned退回补充→再提交→reviewed","mandatory":False,"idempotency_key":"assign:demo:returned-branch:r1"} ,ck=A)
    show("assign",st,j); TID=j["task_id"]
    show("start",*call("/api/training-tasks/%s/start"%TID,"POST",{},ck=D))
    show("submit不合格",*call("/api/training-tasks/%s/submit"%TID,"POST",{"learning_record":"还没写好"},ck=D))
    show("退回",*call("/api/training-tasks/%s/review"%TID,"POST",{"decision":"returned","reason":"缺少事件复盘与两项行动，退回补充。"},ck=A))
    show("补草稿(PATCH)",*call("/api/training-tasks/%s/draft"%TID,"PATCH",{"learning_record":"复盘完成；行动A：三秒车距；行动B：疲劳双提醒开启。"},ck=D))
    show("再提交",*call("/api/training-tasks/%s/submit"%TID,"POST",{"learning_record":"复盘完成；行动A：三秒车距；行动B：疲劳双提醒开启。","feedback":"补交"},ck=D))
    show("通过",*call("/api/training-tasks/%s/review"%TID,"POST",{"decision":"approved","reason":"补充后满足完成条件；通过。无后续真实快照，复评=待下一周期。"},ck=A))
    st,v,_=call("/api/training-tasks/%s"%TID,"GET",None,ck=A)
    print("TR03 view: status=",v.get("task",{}).get("status")," actions=",[e["action"] for e in v.get("timeline",[])])
    print("reassess:", json.dumps(v.get("reassess")))
    st,mn,_=call("/api/data/my.trainings?limit=20","GET",None,ck=D)
    print("司机my任务:", st, [(x["task_id"],x["status"]) for x in mn.get("rows",[])])
    # EV05 第二条(若未建)：identity+全状态
    st,rrs,_=call("/api/data/my.review_requests?limit=10","GET",None,ck=D)
    print("我的申请:", st, [(x["request_id"],x["status"]) for x in rrs.get("rows",[])])
    st,db,_=call("/api/data/admin.score_snapshots?limit=1&driver_id=DEMO_D0149","GET",None,ck=A)
    print("评分事实复核:", db["rows"][0]["safety_score"], db["rows"][0]["risk_level"], db["rows"][0]["confidence_level"])
    print("BRANCH_DONE")
except Exception:
    traceback.print_exc()
