# -*- coding: utf-8 -*-
"""파일을 Confluence 쪽에 첨부한다.

  python tools/manual/attach_to_confluence.py <pageId> <파일> [<파일> ...]

■ 왜 만들었는가
  매뉴얼·TC 를 고칠 때마다 Confluence 첨부는 «사람이 직접» 올려야 했다. 그래서
  본문은 최신인데 첨부는 옛 판인 상태가 계속 남았다(2026-08-25 문서에도 그렇게
  적혀 있다). 올리는 수단이 없어서였지 올리면 안 되는 일이 아니었다.

■ 어떻게
  경로가 «처음 올릴 때» 와 «갱신할 때» 가 다르다. 이름으로 먼저 찾아 갈라 쓴다.
    새로     POST /wiki/rest/api/content/{id}/child/attachment
    갱신     POST /wiki/rest/api/content/{id}/child/attachment/{attId}/data
  🔴 새로 올리는 경로에 «이미 있는 이름» 을 보내면 400 으로 거부한다 —
     "Cannot add a new attachment with same file name as an existing attachment".
     그래서 갱신인지 아닌지를 먼저 판정해야 한다 (2026-08-29 실제로 겪음).
  인증은 docx_to_confluence.py 와 같은 .env 의 JIRA_EMAIL · JIRA_TOKEN 을 쓴다.
  ⚠ 토큰은 화면에 찍지 않는다.

■ 함정
  · 헤더에 X-Atlassian-Token: no-check 가 없으면 CSRF 로 막힌다
  · multipart 본문을 손으로 만든다 (requests 가 이 PC 에 없다)
  · 파일 이름은 «그대로» 보낸다 — 한글 이름이라 RFC 2231 로 인코딩하면 오히려 깨진다
"""
import base64
import json
import mimetypes
import os
import sys
import urllib.request
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def _env(keys):
    vals = {}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() in keys:
                    vals[k.strip()] = v.strip().strip('"').strip("'")
    return vals


def _multipart(path):
    """파일 하나짜리 multipart 본문을 만든다. (본문, Content-Type) 을 준다."""
    boundary = "----vitron" + uuid.uuid4().hex
    name = os.path.basename(path)
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        blob = f.read()
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{name}"\r\n'
        f"Content-Type: {ctype}\r\n\r\n"
    ).encode("utf-8")
    mid = (
        f"\r\n--{boundary}\r\n"
        'Content-Disposition: form-data; name="minorEdit"\r\n\r\ntrue\r\n'
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    return head + blob + mid, f"multipart/form-data; boundary={boundary}"


def upload(page_id, paths):
    env = _env({"JIRA_EMAIL", "JIRA_TOKEN", "JIRA_HOST"})
    email, token = env.get("JIRA_EMAIL"), env.get("JIRA_TOKEN")
    host = env.get("JIRA_HOST", "vi-tron.atlassian.net")
    if not email or not token:
        raise SystemExit("FAIL: .env 에 JIRA_EMAIL / JIRA_TOKEN 이 없습니다")
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()

    base = f"https://{host}/wiki/rest/api/content/{page_id}"
    req = urllib.request.Request(
        base, headers={"Authorization": f"Basic {auth}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        title = json.loads(r.read().decode("utf-8"))["title"]
    print(f"대상: {title}")

    # 이미 붙어 있는 것들을 이름으로 훑어 둔다 — 갱신인지 새로인지 가르기 위해서다.
    req = urllib.request.Request(
        base + "/child/attachment?limit=200",
        headers={"Authorization": f"Basic {auth}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        have = {a["title"]: a["id"] for a in json.loads(r.read().decode("utf-8"))["results"]}

    for p in paths:
        if not os.path.exists(p):
            print(f"  건너뜀 (없음): {p}")
            continue
        name = os.path.basename(p)
        att = have.get(name)
        url = (base + f"/child/attachment/{att}/data") if att else (base + "/child/attachment")
        body, ctype = _multipart(p)
        req = urllib.request.Request(
            url, data=body, method="POST",
            headers={"Authorization": f"Basic {auth}",
                     "Content-Type": ctype,
                     "X-Atlassian-Token": "no-check",
                     "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read().decode("utf-8"))
        item = (res.get("results") or [res])[0]
        ver = item.get("version", {}).get("number", "?")
        kb = os.path.getsize(p) // 1024
        print(f"  {'갱신' if att else '새로'}  {name}  ({kb:,} KB · 판 {ver})")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    upload(sys.argv[1], sys.argv[2:])
