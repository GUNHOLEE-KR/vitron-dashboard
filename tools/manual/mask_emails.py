# -*- coding: utf-8 -*-
"""
설정 화면 캡처에서 개인 메일 주소를 가린다.

  python tools/manual/mask_emails.py

매뉴얼은 파일로 돌아다니기 쉬우므로 실제 메일 주소를 그대로 싣지 않는다.
원본(*.png)은 건드리지 않고 «_masked» 사본을 만들며, 매뉴얼 생성기가
사본이 있으면 그것을 우선 쓴다.

■ 왜 좌표를 직접 적는가
  처음에는 «작은 회색 글씨 줄»을 밝기로 찾아 가렸는데, 탭 메뉴·주소창·제목까지
  흐려졌다. 화면 구조를 설명하는 캡처에서 메뉴가 뭉개지면 쓸 수 없다.
  그래서 캡처별로 «메일이 있는 사각형»만 지정한다. 캡처를 다시 찍으면
  아래 좌표도 함께 손봐야 한다.
"""
import os
import sys

try:
    from PIL import Image, ImageFilter
except ImportError:
    print("Pillow 가 필요합니다:  pip install pillow")
    sys.exit(1)

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
CAP = os.path.join(ROOT, "docs", "manual", "captures")

# 캡처별 마스킹 영역 — (x0, y0, x1, y1) 픽셀. 메일 주소 글자만 덮는다.
# 직원 카드는 약 87px 간격으로 반복되므로 시작 y 에 간격을 더해 생성한다.
def card_rows(first_y, count, step=87, x0=150, x1=300, h=15):
    return [(x0, first_y + step * i, x1, first_y + step * i + h) for i in range(count)]


REGIONS = {
    # 1920x1032 · 직원 카드 8개가 보인다 (이건호 y=442 부터)
    "31_설정_전체_1.png": card_rows(442, 8),
    # 1920x1032 · 스크롤된 상태, 카드 4개 (윤인철 y=225 부터)
    "31_설정_전체_2.png": card_rows(225, 4),
    # 900x214 · 카드 머리글의 메일 + 입력칸 안의 메일
    "34_정보수정_펼침.png": [(130, 60, 260, 76), (320, 172, 470, 192)],
}

BLUR = 6


def mask_one(name, boxes):
    src = os.path.join(CAP, name)
    if not os.path.exists(src):
        return None, "원본 없음"
    stem, ext = os.path.splitext(name)
    dst = os.path.join(CAP, f"{stem}_masked{ext}")

    im = Image.open(src).convert("RGB")
    W, H = im.size
    done = 0
    for (x0, y0, x1, y1) in boxes:
        if x1 > W or y1 > H:
            continue
        region = im.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(BLUR))
        im.paste(region, (x0, y0, x1, y1))
        done += 1
    im.save(dst)
    return dst, f"{done}곳 처리"


if __name__ == "__main__":
    print("메일 주소 마스킹 — 원본은 그대로 두고 _masked 사본을 만듭니다\n")
    for name, boxes in REGIONS.items():
        path, msg = mask_one(name, boxes)
        print(f"  {'OK  ' if path else 'SKIP'} {name}  →  {msg}")
    print("\n생성된 사본은 매뉴얼 생성기가 자동으로 우선 사용합니다.")
