# -*- coding: utf-8 -*-
"""매뉴얼 DOCX 를 Confluence 로 옮긴다.

  python tools/manual/docx_to_confluence.py                    # 마크다운 파일만 생성
  python tools/manual/docx_to_confluence.py --upload <pageId>  # Confluence 쪽에 반영

■ 왜 REST 로 올리는가
  변환 결과가 3만 자를 넘어 사람이(또는 대화 도구가) 본문을 옮겨 붙이면 실수가 난다.
  파일에서 곧바로 올려야 정본과 어긋나지 않는다. 인증은 프로젝트 루트 `.env` 의
  `JIRA_EMAIL` · `JIRA_TOKEN`(Atlassian 계정 토큰 — Confluence 에도 통한다)을 쓴다.
  ⚠ 토큰은 화면에 찍지 않는다.

■ 왜 있는가
  매뉴얼은 DOCX 가 정본이고, 같은 내용을 Confluence 에도 올려 둔다. 손으로 옮기면
  둘이 어긋나므로 정본에서 기계적으로 변환한다. 매뉴얼을 고치면 이 스크립트를
  다시 돌려 Confluence 를 갱신한다.

■ 변환 규칙
  제목 1/2/3      →  ## / ### / ####   (페이지 제목이 이미 h1 이므로 한 단계 내린다)
  본문             →  그대로. run 의 굵게는 **…** 로 복원
  표               →  마크다운 표. 첫 행을 머리글로 본다
  그림             →  ▸ 캡션 한 줄로 남긴다 (Confluence 에 그림을 첨부할 수단이 없다)
  참고/주의 상자    →  > 인용 블록
  글머리·번호 목록  →  - / 1.
  수식·주소        →  코드 표기

■ Confluence 함정 대응
  · 표 칸이 «-» «+» «1.» 로 시작하면 목록으로 바뀌어 표가 깨진다 → 앞에 보이지 않는
    처리를 하지 않고, 문구 자체를 바꾸지 않으려 «\\» 를 붙이지도 않는다. 대신 해당
    칸을 찾아 경고만 띄우고, 실제로 걸리면 사람이 문구를 고친다.
  · 파이프(|) 는 표를 깨뜨리므로 전각(｜)으로 바꾼다.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from docx import Document  # noqa: E402
from docx.shared import RGBColor  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
DOCX = os.path.join(ROOT, "docs", "manual", "업무현황_대시보드_사용자매뉴얼.docx")
CAPTION_GRAY = "777777"

_warn = []


def runs_to_md(par):
    """문단의 run 을 마크다운으로. 굵은 run 은 **…** 로 감싼다."""
    out = []
    for r in par.runs:
        t = r.text
        if not t:
            continue
        t = t.replace("|", "｜")
        if r.bold and t.strip():
            lead = len(t) - len(t.lstrip())
            tail = len(t) - len(t.rstrip())
            out.append(t[:lead] + "**" + t.strip() + "**" + (t[len(t) - tail:] if tail else ""))
        else:
            out.append(t)
    return "".join(out).strip()


def is_caption(par):
    for r in par.runs:
        if r.font.color and r.font.color.rgb == RGBColor.from_string(CAPTION_GRAY):
            return True
    return False


def is_box(par):
    """참고/주의 상자 — 문단 테두리(w:pBdr)가 있는 것으로 판별한다."""
    pPr = par._p.pPr
    return pPr is not None and pPr.find(
        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}pBdr") is not None


def is_code(par):
    """수식·주소 — 고정폭 글꼴(Consolas)로 넣은 줄."""
    return any(r.font.name == "Consolas" for r in par.runs if r.text.strip())


def table_to_md(t):
    lines = []
    ncol = len(t.rows[0].cells)
    for ri, row in enumerate(t.rows):
        cells = []
        for c in row.cells[:ncol]:
            txt = " ".join(runs_to_md(p) for p in c.paragraphs if p.text.strip())
            txt = txt.strip() or " "
            if re.match(r"^[-+]\s|^\d+\.\s", txt):
                _warn.append(txt[:40])
            cells.append(txt)
        lines.append("| " + " | ".join(cells) + " |")
        if ri == 0:
            lines.append("| " + " | ".join(["---"] * ncol) + " |")
    return lines


def _flush_list(out):
    """목록 줄을 이어 쓸 때 — 목록 시작 앞에는 빈 줄이 필요하다."""
    if out and out[-1] and not out[-1].startswith(("- ", "  - ")) \
            and not re.match(r"^\d+\.\s", out[-1]):
        out.append("")


def _close_list(out):
    """목록 다음에 일반 문단이 오면 빈 줄을 넣는다.

    빈 줄이 없으면 그 문단이 목록 항목에 흡수돼 «동작에서 꼭 알아 두실 점» 같은
    설명이 마지막 항목에 붙어 버린다.
    """
    if out and (out[-1].startswith(("- ", "  - ")) or re.match(r"^\d+\.\s", out[-1])):
        out.append("")


def convert(path):
    d = Document(path)
    body = d.element.body
    # 문단·표를 문서 순서대로 순회한다
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    items = []
    for child in body.iterchildren():
        tag = child.tag.split("}")[-1]
        if tag == "p":
            items.append(Paragraph(child, d))
        elif tag == "tbl":
            items.append(Table(child, d))

    out = []
    in_toc = False
    for it in items:
        if not isinstance(it, Paragraph):
            _close_list(out)
            out.append("")
            out.extend(table_to_md(it))
            out.append("")
            continue

        style = it.style.name
        text = runs_to_md(it)
        has_pic = bool(it._p.findall(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}inline"))

        if has_pic:
            continue                       # 그림 자체는 옮길 수 없다 — 캡션만 남긴다
        if not text:
            continue

        if style == "Heading 1":
            if text.strip() in ("목    차", "목차"):
                in_toc = True
                out += ["", "## 목차", ""]
                continue
            in_toc = False
            out += ["", f"## {text}", ""]
            continue
        if style == "Heading 2":
            out += ["", f"### {text}", ""]
            continue
        if style == "Heading 3":
            out += ["", f"#### {text}", ""]
            continue

        if in_toc:
            # 장은 굵게 나오고 절은 그렇지 않다 — 절을 한 단 들여 하위 목록으로 만든다.
            # ⚠ 들여쓰기는 «4칸» 이어야 한다. 2칸으로 하면 마크다운이 하위 목록으로 보지
            #   않아 장과 절이 한 단으로 평평해진다(실제로 그렇게 올라간 적 있음).
            is_chapter = text.startswith("**")
            out.append(f"- {text}" if is_chapter else f"    - {text}")
            continue
        if is_caption(it):
            _close_list(out)
            out += [f"▸ _{text}_", ""]
            continue
        if is_box(it):
            _close_list(out)
            out += [f"> {text}", ""]
            continue
        if is_code(it):
            out += ["```", text.replace("｜", "|"), "```", ""]
            continue
        if text.startswith("· ") or text.startswith("- "):
            _flush_list(out)
            out.append(f"- {text[2:]}")
            continue
        # 절차 목록 — 「**1.** 내용」 으로 나온 것을 마크다운 번호 목록으로 되돌린다
        m = re.match(r"^\*\*(\d+)\.\*\*\s*(.*)$", text)
        if m:
            _flush_list(out)
            out.append(f"{m.group(1)}. {m.group(2)}")
            continue
        if re.match(r"^\d+\.\s", text):
            _flush_list(out)
            out.append(text)
            continue
        _close_list(out)
        out += [text, ""]

    # 빈 줄 3개 이상은 2개로 줄인다
    md = "\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md).strip() + "\n"
    return md


def _page_count():
    """인쇄용 PDF 의 쪽수를 센다. 못 세면 None.

    ⚠ 예전에는 이 값이 «28쪽» 으로 하드코딩돼 있어, 매뉴얼이 36쪽으로 늘어난 뒤에도
    다시 돌리면 옛 숫자가 그대로 올라갔다(내용이 같아 Confluence 버전조차 오르지 않아
    갱신된 줄 알고 넘어갔다). 그래서 파일에서 직접 센다.
    """
    pdf = os.path.join(ROOT, "docs", "manual", "업무현황_대시보드_사용자매뉴얼.pdf")
    try:
        with open(pdf, "rb") as f:
            raw = f.read().decode("latin-1")
        n = len(re.findall(r"/Type\s*/Page[^s]", raw))
        return n or None
    except Exception:
        return None


def _capture_count():
    """캡처 장수를 센다. `_masked` 사본은 같은 화면의 가린 판이라 빼고 센다."""
    d = os.path.join(ROOT, "docs", "manual", "captures")
    try:
        return len([n for n in os.listdir(d)
                    if n.lower().endswith(".png") and not os.path.splitext(n)[0].endswith("_masked")])
    except Exception:
        return None


def header():
    """머리말을 만든다. 쪽수·캡처 수는 «세어서» 넣는다 — 적어 두면 반드시 옛말이 된다."""
    pages = _page_count()
    caps = _capture_count()
    page_txt = f" ({pages}쪽)" if pages else ""
    cap_txt = f" — {caps}장" if caps else ""
    return f"""이 문서는 사용자 매뉴얼 **정본(DOCX)에서 자동 변환**한 것입니다. 매뉴얼을 고치면
`tools/manual/docx_to_confluence.py` 를 다시 돌려 이 쪽을 갱신합니다. 손으로 고치면 정본과 어긋납니다.

| 항목 | 값 |
| --- | --- |
| 정본 | `docs/manual/업무현황_대시보드_사용자매뉴얼.docx`{page_txt} |
| 인쇄용 | 같은 폴더의 `.pdf` |
| 생성기 | `tools/manual/build_dashboard_manual.py` |
| 화면 캡처 | `docs/manual/captures/`{cap_txt} |

> **화면 그림은 이 쪽에 없습니다**
> 그림 자리에 「▸ 그림 번호 · 설명」만 남겨 두었습니다. 그림까지 보시려면 위 DOCX 나 PDF 를
> 열어 주십시오. 대신 그림 없이도 읽을 수 있도록 설명을 함께 실었습니다.

---
"""


def _env(keys):
    """프로젝트 루트 .env 에서 값을 읽는다(값은 반환만 하고 찍지 않는다)."""
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


def upload(md, page_id, title=None):
    """Confluence 쪽 본문을 교체한다. 마크다운 → storage(XHTML) 로 바꿔 보낸다."""
    import base64
    import json
    import urllib.request
    import markdown as md_lib

    env = _env({"JIRA_EMAIL", "JIRA_TOKEN", "JIRA_HOST"})
    email, token = env.get("JIRA_EMAIL"), env.get("JIRA_TOKEN")
    host = env.get("JIRA_HOST", "vi-tron.atlassian.net")
    if not email or not token:
        raise SystemExit("FAIL: .env 에 JIRA_EMAIL / JIRA_TOKEN 이 없습니다")

    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    hdr = {"Authorization": f"Basic {auth}", "Content-Type": "application/json",
           "Accept": "application/json"}

    def call(method, url, payload=None):
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data, headers=hdr, method=method)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))

    base = f"https://{host}/wiki/rest/api/content/{page_id}"
    cur = call("GET", base + "?expand=version,space")
    ver = cur["version"]["number"]
    title = title or cur["title"]
    print(f"대상: {title} (현재 버전 {ver})")

    html = md_lib.markdown(md, extensions=["tables", "fenced_code", "sane_lists"])
    body = {
        "id": str(page_id),
        "type": "page",
        "title": title,
        "space": {"key": cur["space"]["key"]},
        "body": {"storage": {"value": html, "representation": "storage"}},
        "version": {"number": ver + 1,
                    "message": "매뉴얼 정본(DOCX)에서 자동 변환 반영"},
    }
    res = call("PUT", base, body)
    print(f"완료: 버전 {res['version']['number']} · 본문 {len(html):,}자(HTML)")
    return res


if __name__ == "__main__":
    if "--upload" in sys.argv:
        i = sys.argv.index("--upload")
        page_id = sys.argv[i + 1]
        md_all = convert(DOCX)
        cut = md_all.find("## 목차")
        if cut > 0:
            md_all = header() + "\n" +md_all[cut:]
        upload(md_all, page_id)
        sys.exit(0)

    md = convert(DOCX)
    # 표지(제목·버전·작성일)는 Confluence 에서 필요 없다 — 목차부터 싣고 안내를 앞에 붙인다
    cut = md.find("## 목차")
    if cut > 0:
        md = header() + "\n" +md[cut:]
    dst = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        ROOT, "docs", "manual", "confluence_body.md")
    with open(dst, "w", encoding="utf-8", newline="\n") as f:
        f.write(md)
    print(f"변환 완료: {dst}")
    print(f"  {len(md):,}자 · 줄 {md.count(chr(10)):,} · 표 {md.count('| --- |')}개")
    if _warn:
        print(f"⚠ 표 칸이 목록으로 바뀔 수 있는 문구 {len(_warn)}건:")
        for w in _warn[:10]:
            print(f"    {w}")
