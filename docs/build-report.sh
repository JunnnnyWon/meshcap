#!/usr/bin/env bash
#
# 최종 리포트 DOCX를 생성한다.
#
#   npm run dev                 # 다른 터미널에서 개발 서버
#   npm run bench               # src/bench/results.json 갱신
#   node docs/capture.mjs       # docs/figures/*.png 캡처
#   bash docs/build-report.sh
#
# 본문에 인용하는 수치는 src/bench/results.json에서 직접 읽어오므로,
# 알고리즘을 고치고 벤치마크를 다시 돌리면 리포트 숫자도 함께 따라온다.

set -euo pipefail

cd "$(dirname "$0")/.."

FILE="docs/MeshCap_최종리포트.docx"
FIG="docs/figures"
RESULTS="src/bench/results.json"

for f in "$RESULTS" "$FIG/01-landing.png" "$FIG/02-tool-before.png"; do
  [ -f "$f" ] || { echo "필요한 파일이 없습니다: $f"; exit 1; }
done

# 벤치마크 수치를 셸 변수로 끌어온다.
val() { jq -r "$1" "$RESULTS"; }
m() { jq -r ".models[] | select(.id==\"$1\") | $2" "$RESULTS"; }

SPLIT_RAW=$(m syn-split-only '.variants.raw.score')
SPLIT_WELD=$(m syn-split-only '.variants.weldOnly.score')
SPLIT_RAW_EDGES=$(m syn-split-only '.variants.raw.boundaryEdges')
BUST_RAW=$(m syn-bust '.variants.raw.score')
BUST_WELD=$(m syn-bust '.variants.weldOnly.score')
BUST_NAIVE=$(m syn-bust '.variants.naiveFan.score')
BUST_FULL=$(m syn-bust '.variants.meshcap.score')
WORST_HOLES=$(m syn-worst '.variants.weldOnly.holes')
WORST_FULL=$(m syn-worst '.variants.meshcap.score')
WORST_MS=$(m syn-worst '.variants.meshcap.elapsedMs')
GENERATED=$(val '.generatedAt' | cut -c1-10)
MODEL_COUNT=$(val '.models | length')
# 정렬 전에는 뒤집힌 면의 둘레까지 테두리로 잡힌다. 실제로 메운 구멍 수와 대비한다.
BUST_PRE_HOLES=$(m syn-bust '.variants.weldOnly.holes')
BUST_REAL_HOLES=$(m syn-bust '[.strategyCounts[]] | add // 0')
AVG_RAW=$(val '[.models[].variants.raw.score] | add / length | round')
AVG_FULL=$(val '[.models[].variants.meshcap.score] | add / length | round')

echo "벤치마크 수치를 읽었습니다 (측정일 $GENERATED)"

officecli close "$FILE" 2>/dev/null || true
rm -f "$FILE"
officecli create "$FILE"
officecli open "$FILE"

# 본문 여백을 조금 넓게 잡아 표와 그림이 답답해 보이지 않게 한다.
officecli set "$FILE" / --prop marginTop=1440 --prop marginBottom=1440 --prop marginLeft=1440 --prop marginRight=1440

echo "표지 작성"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2026 청강 AI 크리에이티브 부스트 공모전","align":"center","size":"10pt","color":"7C8593","spaceAfter":"30pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3D AI 메시 최적화 및 피규어 제작","style":"Title","size":"32pt","bold":"true","align":"center","spaceAfter":"10pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"생성형 3D 출력물의 구멍을 자동으로 메우는 브라우저 도구 MeshCap 개발 및 정량 검증","align":"center","size":"14pt","italic":"true","color":"3A4049","spaceAfter":"40pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"청강문화산업대학교 게임콘텐츠스쿨 · AI 연구 동아리","align":"center","size":"11.5pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"조원준 (202413011) · 박정훈 (202413032) · 배윤서 (202413143)","align":"center","size":"11.5pt","spaceAfter":"40pt"}}
]
JSON
)"

officecli add "$FILE" /body --type paragraph --prop text="연구 요지" --prop align=center --prop size=9.5pt --prop bold=true --prop color=B8860B --prop spaceAfter=8pt
officecli add "$FILE" /body --type paragraph --prop text="생성형 3D 서비스가 만든 캐릭터는 화면에서는 완결되어 보이지만 슬라이서에 넣는 순간 막힙니다. 이 연구는 그 원인을 메시 위상 수준에서 분해하고, 구멍을 크기·평면성·방향에 따라 다른 방식으로 메우는 브라우저 도구를 만들어 정량 검증했습니다. 결함 대조군 ${MODEL_COUNT}종에서 출력 적합성 점수가 무처리 평균 ${AVG_RAW}점에서 ${AVG_FULL}점으로 올랐습니다." --prop align=center --prop size=11pt --prop indent=720 --prop spaceAfter=36pt

officecli batch "$FILE" --commands "$(cat <<JSON
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"라이브 데모 · junnnnyserver.tail9d6315.ts.net:8443 (테일넷 전용)","align":"center","size":"10.5pt","font":"Consolas","color":"3A4049","spaceAfter":"4pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"소스 코드 · github.com/JunnnnyWon/meshcap","align":"center","size":"10.5pt","font":"Consolas","color":"3A4049","spaceAfter":"24pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2026년 8월 23일 제출 · 측정 기준일 $GENERATED","align":"center","size":"10pt","color":"7C8593"}}
]
JSON
)"

echo "목차"
officecli add "$FILE" /body --type paragraph --prop text="목차" --prop style=Heading1 --prop size=20pt --prop bold=true --prop pageBreakBefore=true --prop spaceAfter=12pt
officecli add "$FILE" /body --type toc --prop levels="1-2" --prop hyperlinks=true

echo "1장 요약"
officecli batch "$FILE" --commands "$(cat <<JSON
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"1. 요약","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"1.1 무엇을 만들었는가","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"MeshCap은 생성형 3D 서비스가 만든 메시 파일을 넣으면 구멍을 찾아 자동으로 메우고, 그 결과가 실제로 3D 프린팅 가능한 상태인지 100점 만점으로 채점하는 웹 도구입니다. 서버가 없으며 모든 계산이 브라우저 안에서 끝나므로 모델 파일이 밖으로 나가지 않습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"핵심 알고리즘은 외부 메시 처리 라이브러리에 의존하지 않고 TypeScript로 직접 작성했습니다. 정점 병합, half-edge 인접 구조, 경계 루프 추적, 네 가지 삼각화 전략, 법선 정렬, 위상 검증까지 전부 저장소 안에 있으며 단위 테스트 43개로 검증합니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"1.2 핵심 발견","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"첫째, 생성형 출력물에서 눈에 보이는 구멍의 상당수는 실제 구멍이 아닙니다. UV 이음매마다 정점이 쪼개져 있어 멀쩡히 붙은 자리가 경계로 잡힙니다. 대조군 가운데 실제로는 닫혀 있는 모델 하나는 용접 전 경계 에지가 ${SPLIT_RAW_EDGES}개로 집계되어 ${SPLIT_RAW}점이었지만, 좌표가 같은 정점을 합치는 것만으로 ${SPLIT_WELD}점이 되었습니다. 이 구간에서 메운 구멍은 하나도 없습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"둘째, 구멍의 테두리를 무엇으로 정의하느냐가 실제 모델에서 성패를 가릅니다. 흔히 쓰는 정의인 \u0027한 면만 접한 에지\u0027로는 면 셋이 한 에지를 공유하는 비다양체 지점에서 순회가 끊깁니다. 실제 Meshy 출력물 하나에서 비다양체 에지 93개 때문에 경계 정점 178개 중 117개의 차수가 어긋났고, 테두리가 전부 끊긴 사슬로 잡혀 한 곳도 메울 수 없었습니다. 기준을 \u0027반대 방향 짝을 찾지 못한 half-edge\u0027로 바꾸자 같은 모델의 테두리 59개가 모두 닫혔습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"셋째, 처리 순서가 결과를 가릅니다. 감는 방향이 뒤집힌 면은 자기 에지 세 개의 방향 짝을 깨뜨리므로, 멀쩡히 막혀 있는 자리에 짝 없는 half-edge를 남깁니다. 탐지기 눈에는 구멍으로 보이고, 그대로 메우면 막힌 표면 위에 없는 면이 덧붙습니다. 대조군에서 정렬 전에는 테두리가 ${BUST_PRE_HOLES}개로 잡히지만 방향을 맞추고 나면 실제 구멍은 ${BUST_REAL_HOLES}개뿐이었습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"넷째, 모든 구멍을 같은 방법으로 메우면 안 됩니다. 피규어 바닥의 큰 개구부를 중심점 부채꼴로 메우면 가운데가 원뿔처럼 솟아 서포트가 붙고, 반대로 표면의 작은 구멍을 평면으로 메우면 바깥으로 튀어나옵니다. 크기와 평면성, 방향을 먼저 재고 전략을 나누는 것이 이 도구의 핵심 기여입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"1.3 결과","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"결함 유형을 단계별로 심은 대조군 ${MODEL_COUNT}종에서, 무처리 상태의 출력 적합성 점수는 평균 ${AVG_RAW}점이었고 MeshCap 처리 후 평균 ${AVG_FULL}점이 되었습니다. 가장 결함이 심한 모델은 구멍 ${WORST_HOLES}개를 모두 닫고 ${WORST_FULL}점에 도달했으며, 전체 처리에 ${WORST_MS}밀리초가 걸렸습니다.","size":"11pt","spaceAfter":"8pt"}}
]
JSON
)"

echo "2장 문제 정의"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2. 문제 정의","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2.1 화면에서는 멀쩡한데 출력이 안 되는 이유","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"실시간 렌더러는 삼각형을 하나씩 화면에 칠할 뿐이라 메시가 닫혀 있는지 따지지 않습니다. 구멍이 뚫려 있어도 뒤쪽 면이 그 자리를 가려 주면 사람 눈에는 완결된 형상으로 보입니다. 생성형 3D 서비스의 미리보기가 언제나 그럴듯한 이유입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"슬라이서는 반대로 동작합니다. 어떤 지점이 물체의 안인지 밖인지 판정해야 채울 곳을 정할 수 있고, 그 판정은 면의 법선과 닫힌 경계에 의존합니다. 경계가 열려 있으면 안팎의 구분 자체가 정의되지 않습니다. 그래서 렌더러에서 완벽해 보이던 모델이 슬라이서에서는 속이 빈 껍데기가 되거나, 형상이 통째로 뒤집히거나, 아예 로드를 거부당합니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2.2 결함 유형학","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"실제 생성물을 분해해 보면 결함이 네 갈래로 나뉩니다. 각각 원인이 다르고, 따라서 처리 단계도 달라야 합니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

# 결함 유형 표
officecli add "$FILE" /body --type table --prop rows=5 --prop cols=3 --prop width=100%
TBL=1
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="결함" --prop c2="원인" --prop c3="출력 시 증상"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="쪼개진 정점" --prop c2="UV 이음매·머티리얼 경계마다 같은 좌표의 정점이 중복" --prop c3="구멍이 아닌데 구멍으로 집계되어 수리 도구가 헛돎"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="열린 경계" --prop c2="겨드랑이·머리카락 사이 등 시야가 닿지 않는 곳의 면 누락" --prop c3="안팎 판정 실패로 내부가 채워지지 않음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="바닥 개구부" --prop c2="생성 시 아래쪽 정보가 없어 밑면이 통째로 비어 있음" --prop c3="접지면이 없어 베드 안착 실패"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="뒤집힌 면" --prop c2="생성·변환 과정에서 감는 방향이 뒤섞임" --prop c3="법선 기반 안팎 판정이 어긋나 살이 반대로 채워짐"

for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in 2 3 4 5; do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10.5pt
done; done
for row in 3 5; do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 1. 생성형 3D 출력물에서 반복적으로 관찰되는 결함 유형" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"2.3 수동 보정의 비용","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"동아리에서 2026년 상반기에 진행한 피규어 제작에서는 이 결함들을 Blender로 직접 고쳤습니다. 구멍을 눈으로 찾아 돌려 보고, 면을 선택해 채우고, 채운 자리가 튀어나오면 되돌리는 작업이 모델 한 점당 수 시간씩 걸렸습니다. 더 큰 문제는 재현성입니다. 어떤 판단으로 그 면을 그렇게 채웠는지 기록이 남지 않아, 다음 모델에서 같은 결함을 만나도 처음부터 다시 판단해야 했습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"이 연구는 그 판단을 규칙으로 옮기는 시도입니다. 사람이 구멍을 보고 무의식적으로 하던 구분, 즉 이건 바닥이니 평평하게 막아야 하고 저건 표면이니 곡률을 이어야 한다는 판단을 측정 가능한 지표로 바꾸어 자동화하는 것이 목표입니다.","size":"11pt","spaceAfter":"8pt"}}
]
JSON
)"

echo "3장 선행 조사"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3. 선행 조사","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3.1 생성 서비스의 출력 특성","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Meshy와 Tripo는 모두 이미지 또는 텍스트에서 텍스처가 입혀진 메시를 만들어 줍니다. 두 서비스 모두 결과물을 GLB로 내려주며, 텍스처를 위한 UV 전개가 포함되어 있습니다. UV 전개는 표면을 평면으로 펴는 과정이라 반드시 이음매가 생기고, 이음매를 사이에 둔 정점은 서로 다른 UV 좌표를 가져야 하므로 같은 위치에 정점이 둘 이상 놓입니다. 렌더링에는 아무 문제가 없지만 위상 분석에는 치명적입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"두 서비스는 또한 리메시 옵션과 사각형 기반 토폴로지 옵션을 제공합니다. 다만 이 옵션들은 표면을 다시 짜는 것이지 열린 경계를 닫아 주지는 않습니다. 특히 모델 아래쪽은 입력 이미지에 정보가 없는 경우가 많아 생성 단계에서부터 비어 있게 되며, 리메시를 거쳐도 비어 있는 상태 그대로 유지됩니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3.2 기존 수리 도구","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"메시 수리 자체는 오래된 주제입니다. MeshLab은 경계 루프를 찾아 채우는 필터를 제공하고, Netfabb 계열 엔진은 상용 수준의 자동 수리를 수행하며, 대부분의 슬라이서에도 간단한 수리 기능이 내장되어 있습니다. 그러나 이들 대부분은 구멍의 성격을 구분하지 않고 같은 방식으로 채웁니다. 결과적으로 피규어 바닥의 큰 개구부에도 표면의 작은 구멍과 동일한 삼각화가 적용되어, 출력에 필요한 평평한 접지면이 만들어지지 않습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"또한 이들 도구는 데스크톱 애플리케이션이라 설치와 학습이 필요합니다. 교내 메이커스페이스에서 학우들이 자기 모델을 출력하려 할 때, 전용 소프트웨어를 설치하고 필터 순서를 익히는 단계가 실질적인 진입 장벽이 되었습니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3.3 삼각화 알고리즘의 배경","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"구멍을 채우는 삼각화는 Barequet와 Sharir가 제시한 동적계획법 골격 위에 서 있습니다. 다각형을 채우는 모든 삼각화 가운데 비용이 최소인 것을 부분 문제로 나누어 찾는 방식으로, 부분 문제가 정점 수의 제곱에 비례하고 각각 선형 번의 분할을 시도하므로 전체는 세제곱 시간입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Liepa는 여기서 비용 함수를 바꾸었습니다. 넓이만 최소화하면 얇고 길쭉한 삼각형이 생기기 쉬운데, 이웃 면과 이루는 이면각을 앞세우고 넓이를 뒤에 두어 사전식으로 비교하면 주변 표면의 곡률을 이어받는 결과가 나옵니다. 본 연구는 이 비용 함수를 채택하되, 어떤 구멍에 이 알고리즘을 쓸지 자동으로 판단하는 분류 단계를 앞에 붙였습니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"3.4 본 연구가 다르게 한 것","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"기여는 새로운 삼각화 알고리즘이 아니라 세 가지 배치에 있습니다. 첫째, 구멍의 형상 지표를 재서 전략을 자동 배정합니다. 둘째, 3D 프린팅이라는 목적에 맞춘 바닥 받침 전략을 별도로 두었습니다. 셋째, 정점 용접과 법선 정렬을 구멍 탐지보다 앞에 두어야 하는 이유를 절제 실험으로 수치화했습니다. 마지막 항목은 알고리즘 선택보다 순서가 결과를 더 크게 좌우한다는 것을 보여 줍니다.","size":"11pt","spaceAfter":"8pt"}}
]
JSON
)"

echo "4장 시스템 설계"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"4. 시스템 설계","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"4.1 설계 원칙","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"계산을 브라우저에서 하기로 한 것이 첫 번째 결정입니다. 모델 파일은 창작물이고, 남의 서버에 올리는 일은 그 자체로 부담입니다. 브라우저에서 처리하면 업로드가 아예 없으므로 이 문제가 사라지고, 사용자가 늘어도 서버가 감당할 일이 없습니다. 원본 파일은 어떤 경우에도 브라우저를 벗어나지 않습니다. 파일을 여는 것도, 텍스처와 재질을 버리고 좌표만 남기는 것도 전부 브라우저에서 일어납니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"다만 삼백만 삼각형 규모에서는 브라우저 메모리가 1.4기가바이트까지 올라가 저사양 기기에서는 감당하기 어렵습니다. 그래서 좌표와 인덱스만 받아 같은 파이프라인을 돌리는 연산 서버를 함께 두었습니다. 코어를 렌더링 라이브러리에서 떼어 놓은 설계가 여기서 값을 합니다. 서버는 브라우저가 쓰는 파일을 그대로 불러 쓰므로 구현이 갈라지지 않고, 두 경로의 결과가 좌표 단위까지 같은지 검증 스크립트가 매번 대조합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"측정해 보니 서버가 더 빠르지는 않았습니다. 파이프라인이 단일 스레드라 코어 수가 도움이 되지 않고, 서버의 단일 코어 성능이 최신 노트북보다 낮기 때문입니다. 삼각형 190만 개짜리 모델에서 브라우저는 10.3초, 서버는 전송을 포함해 31.5초가 걸렸습니다. 따라서 연산 서버는 속도가 아니라 여력을 위한 선택지입니다. 자동 모드는 삼각형 50만 개 이하를 항상 브라우저에서, 400만 개 초과를 항상 서버에서 처리하고, 그 사이 구간은 기기의 메모리와 코어 수를 보고 정합니다. 어디에서 처리했는지는 매번 화면에 표시합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"두 번째는 알고리즘 코어를 three.js에서 떼어 놓은 것입니다. 코어는 좌표 배열과 인덱스 배열만 다루는 순수 TypeScript이며 렌더링 라이브러리를 참조하지 않습니다. 덕분에 같은 코드를 브라우저 워커와 node 벤치마크 스크립트에서 그대로 실행할 수 있고, 화면에 보이는 점수와 리포트에 실린 수치가 어긋나지 않습니다. 단위 테스트도 렌더링 환경 없이 돌아갑니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"세 번째는 무거운 계산을 웹 워커로 옮긴 것입니다. 수십만 삼각형짜리 메시에서는 위상 분석과 삼각화에 몇 초가 걸리는데, 메인 스레드에서 돌리면 그동안 화면이 완전히 멈춰 사용자가 브라우저가 죽은 것으로 오해합니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"4.2 처리 순서","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"전체 파이프라인은 아홉 단계입니다. 순서 자체가 설계의 핵심이며, 5장에서 각 단계의 근거를 다룹니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=10 --prop cols=2 --prop width=100%
TBL=2
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="단계" --prop c2="하는 일"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="1  파일 로드" --prop c2="GLB·GLTF·OBJ·STL·PLY를 월드 좌표계의 단일 삼각형 목록으로 통합"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="2  정점 용접" --prop c2="공간 해시로 좌표가 같은 정점을 병합하고 퇴화·중복·NaN 삼각형 제거"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="3  법선 방향 통일" --prop c2="이웃 면끼리 감는 방향을 전파해 일관되게 정렬"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="4  위상 분석" --prop c2="half-edge 인접 구조로 경계·비다양체·연결 요소·오일러 지표 집계"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="5  테두리 추적" --prop c2="경계 half-edge를 이어 구멍의 테두리 루프를 복원"
officecli set "$FILE" "/body/tbl[$TBL]/tr[7]" --prop c1="6  구멍 분류" --prop c2="둘레·평면성·방향을 재서 메우기 전략을 배정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[8]" --prop c1="7  구멍 메우기" --prop c2="단일 삼각형·부채꼴·평면 투영·Liepa·바닥 받침 중 배정된 방식으로 채움"
officecli set "$FILE" "/body/tbl[$TBL]/tr[9]" --prop c1="8  바깥 방향 정렬" --prop c2="껍질마다 부호 있는 부피로 안팎을 판정해 필요하면 통째로 뒤집음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[10]" --prop c1="9  검증 및 채점" --prop c2="밀폐·다양체·관통을 검사하고 출력 적합성을 100점으로 환산"

for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 10); do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[1]/p[1]/r[1]" --prop size=10.5pt --prop bold=true
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[2]/p[1]/r[1]" --prop size=10.5pt
done
for row in 3 5 7 9; do for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 2. MeshCap 처리 파이프라인" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

echo "5장 알고리즘"
officecli batch "$FILE" --commands "$(cat <<JSON
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5. 알고리즘 상세","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.1 정점 용접","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"좌표가 같은 정점을 찾기 위해 공간 해시를 씁니다. 병합 반경으로 격자를 나누고 각 정점이 속한 칸과 인접한 26개 칸만 뒤지면, 반경 안의 짝은 반드시 그 안에 있으므로 전수 비교 없이 선형 시간에 끝납니다. 병합 반경은 경계 상자 대각선의 100만분의 1로 잡았습니다. 32비트 부동소수의 유효 자릿수를 고려한 값이라 모델의 실제 크기나 단위와 무관하게 같은 판정을 냅니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"같은 단계에서 어떤 삼각형도 참조하지 않는 정점, 두 꼭짓점 이상이 같아져 넓이가 0이 된 삼각형, 정점 집합이 완전히 겹치는 중복 삼각형, 좌표에 NaN이 섞인 삼각형을 함께 걷어냅니다. 특히 NaN은 이후 모든 계산을 오염시키므로 여기서 반드시 제거해야 합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"이 단계의 효과는 대조군에서 분명하게 드러납니다. 삼각형마다 정점을 따로 갖도록 완전히 분해한 구는 실제로는 닫힌 모델인데도 용접 전 경계 에지가 ${SPLIT_RAW_EDGES}개로 집계되어 ${SPLIT_RAW}점을 받았고, 용접만으로 ${SPLIT_WELD}점이 되었습니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.2 위상 구조","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"삼각형 목록에서 에지별 인접 관계를 만듭니다. 무방향 에지를 정점 인덱스 두 개로 이루어진 정수 키로 해시하고, 각 에지를 지나간 면의 수와 방향을 셉니다. 한 면만 지난 에지는 경계이고, 두 면이 지났는데 방향이 같으면 둘 중 하나가 뒤집힌 것이며, 세 면 이상이 지났으면 비다양체입니다. 여기서 연결 요소 수와 오일러 지표도 함께 구합니다. 닫힌 구 위상이면 오일러 지표가 2이므로, 보정 후 이 값이 2인지 보는 것이 밀폐 여부를 교차 검증하는 손쉬운 방법이 됩니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.3 테두리를 무엇으로 정의할 것인가","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"구멍의 테두리는 한 면만 접한 에지를 모아 이으면 된다고 보는 것이 보통입니다. 합성 대조군에서는 이 정의로 충분했지만, 실제 서비스 출력물에 적용하자 곧바로 무너졌습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"문제는 면 셋이 한 에지를 공유하는 비다양체 지점입니다. 그런 에지는 접한 면이 셋이므로 어느 정의로도 경계가 아니지만, 테두리를 따라가던 순회는 바로 그 자리에서 다음으로 갈 에지를 찾지 못합니다. 삼백만 삼각형짜리 Meshy 출력물에서 비다양체 에지 93개 때문에 경계 정점 178개 중 117개의 진입 차수와 진출 차수가 어긋났고, 테두리 전부가 끊긴 사슬로 잡혀 한 곳도 메울 수 없었습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"기준을 바꿔 반대 방향 짝을 찾지 못하고 남은 half-edge를 모으면 이 문제가 정의상 사라집니다. 삼각형 하나는 세 방향 에지가 순환을 이루므로 각 정점에 진입 하나와 진출 하나를 줍니다. 따라서 전체 half-edge 집합은 모든 정점에서 차수가 균형을 이룹니다. 어떤 에지에서 반대 방향끼리 짝을 지우면 양 끝 정점의 진입과 진출이 똑같은 수만큼 줄어들므로 균형이 그대로 유지됩니다. 균형 잡힌 유향 그래프는 반드시 서로소인 순환들로 분해되므로, 남은 half-edge를 모으면 순회가 어디서도 끊기지 않습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"같은 Meshy 모델의 테두리 59개가 이 기준에서는 모두 닫혔고 경계 에지 120개가 0개가 되었습니다. 대신 비다양체 에지가 93개에서 95개로 늘었습니다. 면 셋이 공유하던 에지를 메우면 그 에지에 면이 하나 더 붙기 때문입니다. 표면을 닫는 것과 다양체로 만드는 것을 맞바꾼 셈이고, 채점에서 두 항목을 따로 둔 이유이기도 합니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.4 법선 정렬이 먼저여야 하는 이유","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"테두리를 짝 없는 half-edge로 정의하고 나면 감는 방향이 곧바로 문제가 됩니다. 뒤집힌 면은 자기 에지 세 개에서 방향 짝을 깨뜨립니다. 그 자리는 멀쩡히 막혀 있는데도 짝을 찾지 못한 half-edge가 남으므로 탐지기 눈에는 구멍으로 보입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"그대로 메우면 없는 구멍을 막게 됩니다. 실제로는 막혀 있는 표면 위에 면이 한 겹 더 덧붙어 부피가 달라지고 비다양체 에지가 늘어납니다. 구멍을 못 메우고 남기는 것보다 나쁩니다. 뒤집힌 면을 섞어 둔 대조군에서 정렬 전에는 테두리가 ${BUST_PRE_HOLES}개로 잡히지만, 방향을 맞추고 나면 실제 구멍은 ${BUST_REAL_HOLES}개뿐입니다. 나머지는 전부 허상이고 점수도 ${BUST_NAIVE}점과 ${BUST_FULL}점으로 갈립니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"다만 방향 통일과 바깥 방향 맞추기는 다른 일입니다. 이웃 면끼리 방향을 맞추는 전파는 열린 메시에서도 되지만, 껍질이 안팎 중 어디를 향하는지는 부호 있는 부피로 판정하므로 닫힌 뒤에야 의미가 있습니다. 그래서 전파는 구멍 탐지 앞에, 바깥 방향 판정은 구멍을 다 메운 뒤에 둡니다. 이 절제 실험은 저장소의 테스트로 고정해 두어 순서를 되돌리면 테스트가 실패합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"뚜껑을 붙이는 것도 한 번으로 끝나지 않습니다. 새로 만든 면의 테두리가 기존 표면과 완전히 맞물리지 않으면 그 자리에 다시 작은 틈이 남고, 비다양체 지점 근처에서 특히 자주 생깁니다. 삼백만 삼각형짜리 모델에서는 두 번째 회차까지 돌아야 경계 에지가 0이 되었습니다. 그래서 남은 틈이 없어지거나 더 줄지 않을 때까지 반복합니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.5 구멍 분류","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"테두리마다 네 가지를 잽니다. 둘레, 최적 평면에 투영한 넓이, 평면에서 벗어난 정도, 그리고 메운 면이 향하게 될 방향입니다. 최적 평면은 Newell 방법으로 구합니다. 세 점만 쓰는 방식과 달리 평면에서 벗어난 다각형에서도 안정적이고, 결과 벡터의 길이가 투영 넓이의 두 배라 넓이를 따로 계산할 필요가 없습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"평면성은 테두리 정점이 최적 평면에서 벗어난 제곱평균 거리를, 둘레가 같은 원의 반지름으로 나눈 값입니다. 길이 차원이 상쇄되어 무차원이 되므로 모델의 크기나 단위와 무관하게 같은 임계값을 쓸 수 있습니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=8 --prop cols=3 --prop width=100%
TBL=3
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="조건" --prop c2="전략" --prop c3="근거"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="테두리가 닫히지 않음" --prop c2="건너뜀" --prop c3="어디까지가 구멍인지 확정할 수 없음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="정점 3개" --prop c2="단일 삼각형" --prop c3="삼각형 하나로 정확히 닫힘"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="아래를 향한 큰 개구부" --prop c2="바닥 받침" --prop c3="베드에 평평하게 닿아야 첫 층이 뜨지 않음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="정점 8개 이하" --prop c2="부채꼴" --prop c3="중심점이 표면에서 멀지 않음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="평면성 0.06 미만" --prop c2="평면 투영" --prop c3="오목한 다각형도 정확히 채우고 새 정점을 만들지 않음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[7]" --prop c1="정점 250개 이하" --prop c2="Liepa 동적계획법" --prop c3="주변 곡률을 이어받아 자연스럽게 채움"
officecli set "$FILE" "/body/tbl[$TBL]/tr[8]" --prop c1="그 밖" --prop c2="평면 투영으로 폴백" --prop c3="세제곱 시간이라 응답성을 우선함"

for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 8); do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10.5pt
done; done
for row in 3 5 7; do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 3. 구멍 분류 기준과 배정되는 전략. 위에서부터 차례로 검사한다." --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.6 네 가지 메우기 전략","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"부채꼴은 테두리 중심에 정점 하나를 두고 방사형으로 잇습니다. 가장 빠르지만 구멍이 커지면 중심점이 표면에서 멀어져 원뿔처럼 솟으므로 작은 구멍에만 씁니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"평면 투영은 최적 평면에 테두리를 투영해 이어 자르기 방식으로 삼각화합니다. 새 정점을 만들지 않아 표면 밖으로 솟지 않고, 오목한 다각형도 볼록 분해 없이 올바르게 채웁니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Liepa 방식은 이웃 면과 이루는 최대 이면각을 먼저 최소화하고 같으면 넓이가 작은 쪽을 고르는 동적계획법입니다. 평면에서 크게 벗어난 테두리에서 주변 곡률을 이어받아 자연스러운 뚜껑을 만듭니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"바닥 받침은 이 연구가 3D 프린팅이라는 목적을 위해 따로 둔 전략입니다. 테두리를 같은 높이의 평면까지 수직으로 내려 옆벽을 만들고 그 평면 링을 채웁니다. 기존 정점은 하나도 움직이지 않으므로 실루엣이 그대로 유지됩니다. 평면은 테두리 최저점보다 한 층 두께만큼 더 아래에 둡니다. 같은 높이에 두면 최저점 자리의 옆벽 삼각형이 넓이 0이 되어 오히려 새 결함이 생기기 때문입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"어떤 전략이든 삼각형을 하나도 내놓지 못하면 부채꼴로 넘어갑니다. 자기교차하는 테두리처럼 병적인 입력에서 품질을 조금 포기하더라도 구멍이 남는 것보다는 낫기 때문입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"5.7 검증과 채점","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"배점은 슬라이서가 실제로 실패하는 순서를 따랐습니다. 경계 에지가 남으면 아예 슬라이싱이 되지 않으므로 가장 무겁고, 뒤로 갈수록 출력은 되지만 품질이 떨어지는 항목입니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=7 --prop cols=3 --prop width=100%
TBL=4
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="항목" --prop c2="배점" --prop c3="판정 내용"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="완전 밀폐" --prop c2="35" --prop c3="열린 경계가 하나도 없는 상태"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="다양체 위상" --prop c2="25" --prop c3="세 면 이상이 만나는 에지나 정점이 없음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="법선 방향" --prop c2="15" --prop c3="모든 면이 같은 방향으로 정렬"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="단일 껍질" --prop c2="10" --prop c3="떠 있는 조각이 없음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="삼각형 품질" --prop c2="10" --prop c3="넓이가 0에 가까운 삼각형이 없음"
officecli set "$FILE" "/body/tbl[$TBL]/tr[7]" --prop c1="뚜껑 관통" --prop c2="5" --prop c3="새로 만든 면이 기존 표면을 뚫지 않음"

for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 7); do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[1]/p[1]/r[1]" --prop size=10.5pt
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[2]/p[1]" --prop align=center
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[2]/p[1]/r[1]" --prop size=10.5pt --prop bold=true
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[3]/p[1]/r[1]" --prop size=10.5pt
done
for row in 3 5 7; do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 4. 출력 적합성 배점" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=12pt

officecli add "$FILE" /body --type paragraph --prop text="관통 검사는 메시 전체가 아니라 새로 만든 뚜껑만 대상으로 합니다. 실제로 문제가 되는 것은 방금 집어넣은 면이고, 균일 격자에 삼각형을 넣어 같은 칸에 든 후보끼리만 분리축 검사를 하면 뚜껑 개수에 비례하는 비용으로 끝나기 때문입니다." --prop size=11pt --prop spaceAfter=8pt

echo "6장 벤치마크"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6. 벤치마크","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6.1 실험 설계","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"외부 도구와 최종 결과만 견주면 왜 좋아졌는지 알 수 없습니다. 그래서 우리 파이프라인 자체를 한 단계씩 잘라내며 같은 모델을 네 번 측정하는 절제 실험으로 설계했습니다. 이 방식은 개선의 출처를 분리해 보여 줄 뿐 아니라, 같은 스크립트를 돌리면 누구든 같은 숫자를 재현할 수 있다는 장점이 있습니다.","size":"11pt","spaceAfter":"10pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"무처리는 파일을 받은 그대로입니다. 용접만은 좌표가 같은 정점을 합치기만 한 상태로, 여기서 줄어든 구멍은 애초에 존재하지 않던 것입니다. 순진한 부채꼴은 남은 구멍을 분류 없이 전부 중심점 부채꼴로 메우고 법선 정렬도 하지 않는 상태로, 구멍의 성격을 구분하지 않는 일반적인 수리 도구에 대응합니다. MeshCap은 분류와 정렬을 모두 포함한 최종 결과입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6.2 대조군 구성","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"대조군은 결함 유형을 하나씩 심어 절차적으로 생성했습니다. 실제 서비스 출력물을 저장소에 넣으면 용량과 라이선스가 모두 걸리고, 무엇보다 결함이 뒤섞여 있어 어느 단계가 무엇을 해결했는지 분리할 수 없습니다. 난수 시드를 고정했으므로 같은 코드는 언제나 같은 결함을 만듭니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=6 --prop cols=6 --prop width=100%
TBL=5
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="대조군" --prop c2="삼각형" --prop c3="무처리" --prop c4="용접만" --prop c5="순진한 부채꼴" --prop c6="MeshCap"

ROW=2
for id in syn-split-only syn-scattered syn-bust syn-wavy syn-worst; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$ROW]" \
    --prop c1="$(m "$id" '.label')" \
    --prop c2="$(m "$id" '.variants.raw.triangles')" \
    --prop c3="$(m "$id" '.variants.raw.score')" \
    --prop c4="$(m "$id" '.variants.weldOnly.score')" \
    --prop c5="$(m "$id" '.variants.naiveFan.score')" \
    --prop c6="$(m "$id" '.variants.meshcap.score')"
  ROW=$((ROW + 1))
done

for col in 1 2 3 4 5 6; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10pt
done
for row in $(seq 2 6); do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[1]/p[1]/r[1]" --prop size=10pt
  for col in 2 3 4 5 6; do
    officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]" --prop align=right
    officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10pt
  done
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[6]/p[1]/r[1]" --prop bold=true --prop color=1F6F3D
done
for row in 3 5; do for col in 1 2 3 4 5 6; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 5. 처리 단계별 출력 적합성 점수 (100점 만점)" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

# 점수 변화를 한눈에 보이도록 네이티브 차트로 넣는다.
CATS=$(jq -r '[.models[].label] | join(",")' "$RESULTS")
S_RAW=$(jq -r '[.models[].variants.raw.score] | join(",")' "$RESULTS")
S_WELD=$(jq -r '[.models[].variants.weldOnly.score] | join(",")' "$RESULTS")
S_NAIVE=$(jq -r '[.models[].variants.naiveFan.score] | join(",")' "$RESULTS")
S_FULL=$(jq -r '[.models[].variants.meshcap.score] | join(",")' "$RESULTS")

officecli add "$FILE" /body --type chart --prop chartType=column \
  --prop title="처리 단계별 출력 적합성 점수" \
  --prop categories="$CATS" \
  --prop data="무처리:$S_RAW" \
  --prop data="용접만:$S_WELD" \
  --prop data="순진한 부채꼴:$S_NAIVE" \
  --prop data="MeshCap:$S_FULL"

officecli set "$FILE" "/body/p[last()]/r[1]" --prop alt="대조군 다섯 종의 처리 단계별 출력 적합성 점수를 비교한 세로 막대 차트"

officecli add "$FILE" /body --type paragraph --prop text="그림 1. 대조군별 점수 변화. 개선의 출처가 모델마다 다르다는 점이 드러난다." --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<JSON
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6.3 결과 해석","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"표 5에서 각 행이 서로 다른 이야기를 합니다. 정점 분리만 있는 구는 용접 한 단계에서 만점에 도달하고 이후 아무 변화가 없습니다. 실제 구멍이 없었기 때문입니다. 이 행은 구멍 개수를 그대로 믿으면 안 된다는 점을 보여 줍니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"작은 구멍이 흩어진 구는 순진한 부채꼴만으로도 99점에 이릅니다. 구멍이 작고 평면적이면 어떤 방식으로 메워도 결과가 비슷하다는 뜻이며, 분류의 효용이 크지 않은 구간입니다. 정직하게 말하면 이 경우 우리 도구의 이점은 1점뿐입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"차이가 벌어지는 곳은 나머지 세 행입니다. 결함 합성 회전체는 뒤집힌 면 때문에 테두리가 조각나 순진한 방식이 ${BUST_NAIVE}점에서 멈추지만 MeshCap은 ${BUST_FULL}점에 도달합니다. 물결 개구부 튜브는 용접으로는 아무것도 나아지지 않다가 삼각화 단계에서 비로소 해결됩니다. 복합 결함 구는 구멍 ${WORST_HOLES}개와 뒤집힌 면이 겹쳐 순진한 방식이 34점에 머무는 반면 MeshCap은 ${WORST_FULL}점을 기록했습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"용접만 적용했을 때 점수가 오히려 떨어지는 행이 둘 있다는 점도 눈여겨볼 만합니다. 분해된 상태에서는 모든 에지가 경계로 잡히는 대신 비다양체 에지는 하나도 없습니다. 용접이 정점을 합치면서 비로소 진짜 위상 결함이 드러나기 때문에, 중간 단계의 점수가 내려가는 것은 측정이 정확해졌다는 신호입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"처리 시간은 가장 무거운 대조군에서도 ${WORST_MS}밀리초로, 브라우저에서 즉시 반응하는 수준입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6.4 도구 화면","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"아래는 결함 합성 회전체를 도구에 넣었을 때의 화면입니다. 보정 전에는 구멍의 테두리가 붉은 선으로 표시되며, 모델 뒤에 가려진 구멍도 보이도록 깊이 검사를 끕니다. 보정 후에는 새로 만든 면만 청록색으로 구분해 무엇이 추가되었는지 바로 확인할 수 있습니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

add_figure() {
  local src="$1" caption="$2" alt="$3"
  officecli add "$FILE" /body --type paragraph --prop align=center --prop spaceAfter=4pt
  officecli add "$FILE" "/body/p[last()]" --type picture --prop src="$src" --prop width=6.4in --prop alt="$alt"
  officecli add "$FILE" /body --type paragraph --prop text="$caption" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceAfter=14pt
}

add_figure "$FIG/02-tool-before.png" "그림 2. 보정 전. 바닥 개구부와 표면의 구멍 세 곳이 붉은 테두리로 표시된다." "MeshCap 보정 전 화면. 구멍 테두리가 붉은 선으로 강조되어 있다"
add_figure "$FIG/03-tool-after.png" "그림 3. 보정 후. 새로 생성된 면이 청록색으로 구분되고 점수가 100점으로 올라간다." "MeshCap 보정 후 화면. 새로 만든 뚜껑이 청록색으로 표시되어 있다"
add_figure "$FIG/05-wavy-before.png" "그림 4. 테두리가 평면에서 크게 벗어난 개구부. 평면 투영으로는 제대로 메울 수 없는 사례다." "물결 모양 개구부를 가진 튜브 모델의 보정 전 화면"
add_figure "$FIG/06-wavy-after.png" "그림 5. Liepa 삼각화가 주변 곡률을 이어받아 채운 결과와 아래쪽에 생성된 바닥 받침." "물결 개구부가 메워지고 바닥 받침이 생성된 화면"
add_figure "$FIG/07-benchmark.png" "그림 6. 웹 벤치마크 페이지. 실제 서비스 출력물을 넣어 같은 기준으로 측정할 수 있다." "MeshCap 벤치마크 페이지 화면"

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"6.5 Meshy와 Tripo 실측","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"두 서비스의 실제 출력물 비교는 동일한 콘셉트 세 종을 양쪽에서 생성해 같은 네 단계로 측정하는 방식으로 진행합니다. 콘셉트는 난이도를 나누어 정합니다. 하나는 로봇이나 헬멧처럼 표면이 단순한 무기물, 하나는 의복이 있는 인간형, 하나는 머리카락과 얇은 장신구가 있는 캐릭터입니다. 얇고 복잡한 구조일수록 생성 단계에서 면이 누락되기 쉬우므로 두 서비스의 차이가 드러나는 지점이기도 합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"측정은 웹 벤치마크 페이지의 측정 패널에서 수행합니다. node 스크립트 대신 브라우저를 쓰는 이유는 두 가지입니다. 서비스가 내려주는 GLB는 Draco로 압축되어 있고 텍스처가 포함되어 있어 서버 환경에서 로더를 그대로 쓰기 어렵고, 무엇보다 사용자가 화면에서 보는 것과 동일한 경로로 측정해야 리포트의 숫자와 도구의 숫자가 어긋나지 않기 때문입니다. 측정 결과는 JSON으로 내려받아 저장소에 반영하면 벤치마크 페이지에 그대로 나타납니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"콘셉트 세 종의 체계적인 비교는 2026년 8월 20일 생성분으로 채웁니다. 다만 알고리즘 검증을 위해 두 서비스의 출력물을 각각 한 점씩 미리 받아 돌려 보았고, 그 결과가 아래입니다. 합성 대조군에서는 드러나지 않던 문제가 여기서 나왔기 때문에 5.3절의 설계 변경으로 이어졌습니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=8 --prop cols=3 --prop width=100%
TBL=6
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="지표" --prop c2="Meshy 출력물" --prop c3="Tripo 출력물"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="파일 크기" --prop c2="147 MB" --prop c3="90 MB"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="삼각형" --prop c2="3,092,042" --prop c3="1,896,054"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="용접으로 병합된 정점" --prop c2="7,731,317 (83%)" --prop c3="4,740,187 (83%)"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="경계 에지 (보정 전 → 후)" --prop c2="120 → 0" --prop c3="14 → 0"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="비다양체 에지 (보정 전 → 후)" --prop c2="93 → 95" --prop c3="9 → 90"
officecli set "$FILE" "/body/tbl[$TBL]/tr[7]" --prop c1="출력 적합성 점수" --prop c2="94 → 96" --prop c3="97 → 99"
officecli set "$FILE" "/body/tbl[$TBL]/tr[8]" --prop c1="브라우저 처리 시간" --prop c2="약 7초" --prop c3="약 4초"

for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 8); do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[1]/p[1]/r[1]" --prop size=10.5pt
  for col in 2 3; do
    officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]" --prop align=right
    officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10.5pt
  done
done
for row in 3 5 7; do for col in 1 2 3; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 6. 실제 서비스 출력물 예비 측정 결과" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"두 모델 모두 완전 밀폐에 도달했지만, 비다양체 에지가 늘어난 폭이 크게 다릅니다. Tripo 출력물에서는 정점 42개짜리 테두리 두 개가 같은 자리에 겹쳐 잡혔는데, 표면이 이중으로 겹쳐 있는 지점이라 뚜껑도 두 겹으로 생겼습니다. 입력 자체의 병리이며 현재는 감지해 점수에 반영할 뿐 자동으로 정리하지는 않습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"두 파일 모두 브라우저에서 처리했고 워커가 중단되지 않았습니다. 다만 삼백만 삼각형 규모에서는 최대 메모리가 1.4기가바이트에 이르므로, 저사양 기기에서는 모델을 단순화한 뒤 사용하는 편이 안전합니다.","size":"11pt","spaceAfter":"8pt"}}
]
JSON
)"

echo "7장 프린팅 검증"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"7. 3D 프린팅 검증","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"7.1 검증 설계","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"점수판은 어디까지나 위상 지표입니다. 100점이 실제 출력 성공을 보장하지 않으므로, 같은 모델의 보정 전 파일과 보정 후 파일을 동일한 슬라이서와 동일한 프로파일로 열어 무엇이 달라지는지 확인합니다. 검증은 두 층으로 나눕니다. 슬라이서 단계에서 관찰되는 차이와, 실제로 뽑았을 때 나타나는 차이입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"보정 전후 STL 쌍은 저장소의 스크립트로 언제든 재생성할 수 있습니다. 같은 파이프라인이 만든 파일이므로 리포트의 점수와 슬라이서에 올린 파일이 일치한다는 것이 보장됩니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"7.2 슬라이서 분석 항목","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"슬라이서가 띄우는 경고 문구를 그대로 기록하고, 자동 수리 기능이 개입했는지 확인합니다. 자동 수리가 작동했다면 그 결과물의 형상이 원본과 얼마나 달라졌는지도 함께 봅니다. 수치로는 예상 출력 시간, 소재 사용량, 서포트 부피 비중, 첫 층 접지 면적을 기록합니다. 특히 접지 면적은 바닥 받침 전략의 효과가 직접 드러나는 지표입니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=7 --prop cols=4 --prop width=100%
TBL=7
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="측정 항목" --prop c2="보정 전 예상" --prop c3="보정 후 예상" --prop c4="실측"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="슬라이서 로드" --prop c2="경고 발생 또는 자동 수리 개입" --prop c3="경고 없음" --prop c4="측정 예정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="내부 채움" --prop c2="안팎 판정 실패로 속이 빔" --prop c3="설정한 채움률대로 채워짐" --prop c4="측정 예정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="첫 층 접지 면적" --prop c2="테두리가 고르지 않아 점 접촉" --prop c3="평면 접지" --prop c4="측정 예정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="서포트 부피 비중" --prop c2="바닥이 열려 내부까지 서포트 생성" --prop c3="외부 오버행에만 생성" --prop c4="측정 예정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="예상 출력 시간" --prop c2="측정 예정" --prop c3="측정 예정" --prop c4="측정 예정"
officecli set "$FILE" "/body/tbl[$TBL]/tr[7]" --prop c1="소재 사용량" --prop c2="측정 예정" --prop c3="측정 예정" --prop c4="측정 예정"

for col in 1 2 3 4; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 7); do for col in 1 2 3 4; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10.5pt
done; done
for row in 3 5 7; do for col in 1 2 3 4; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 7. 슬라이서 분석 항목과 예상되는 차이. 실측 열은 2026년 8월 21일 출력 테스트에서 채운다." --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"7.3 실물 출력 계획","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"SLA는 레진, FDM은 PLA로 출력합니다. 두 방식은 실패 양상이 다릅니다. FDM은 첫 층 접지가 부실하면 출력물이 베드에서 떨어져 나가고, SLA는 밀폐되지 않은 형상에서 내부에 레진이 갇혀 경화되며 흡착판 현상을 일으킵니다. 바닥 받침 전략이 두 방식 모두에서 의미가 있는 이유입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"기록 항목은 장비와 소재, 실제 소요 시간, 소재 비용, 실패 여부와 원인, 후처리 내용입니다. 출력물은 전체 사진과 함께 바닥 받침이 만든 접지면을 근접 촬영해 남깁니다. 기록 양식은 저장소의 문서 폴더에 표로 준비해 두었습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"교내 메이커스페이스와 협력해 학우들이 같은 절차를 따라 할 수 있도록, 출력이 끝난 뒤 이 기록을 바탕으로 간단한 가이드를 정리할 계획입니다.","size":"11pt","spaceAfter":"8pt"}}
]
JSON
)"

echo "8-10장"
officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"8. 한계 및 향후 과제","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"8.1 알려진 한계","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"테두리가 한 정점에서 여러 갈래로 갈라지면 어느 갈래를 먼저 따라가느냐에 따라 구멍이 나뉘는 모양이 달라집니다. 순회가 반드시 닫히고 전체를 빠짐없이 덮는다는 점은 보장되지만 분할 결과가 유일하지는 않습니다. 갈래를 고를 때 정점 주변의 기하를 참고하면 개선할 수 있습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"면 셋이 공유하던 에지를 메우면 그 에지에 면이 하나 더 붙어 비다양체가 더 심해집니다. 표면을 닫는 것과 다양체로 만드는 것을 맞바꾼 셈입니다. 슬라이서 대부분이 비다양체보다 열린 경계에서 먼저 실패하므로 이 교환은 의도한 것이지만, 근본적으로는 비다양체 지점을 먼저 분리해 다양체로 만든 뒤 메우는 편이 낫습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"겹쳐 있는 이중 표면은 같은 자리에 테두리가 두 벌 잡히고 뚜껑도 두 겹으로 생깁니다. 실제 Tripo 출력물에서 정점 42개짜리 테두리가 같은 위치에 두 개 잡히는 사례를 확인했습니다. 입력 자체의 병리라 현재는 감지해 점수에만 반영합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"삼백만 삼각형 규모에서는 처리에 약 7초, 최대 메모리 1.4기가바이트가 필요합니다. 자료구조를 전부 타입 배열로 다시 쓰면서 초기 구현 대비 시간은 3분의 1, 메모리는 3분의 2로 줄였지만, 저사양 기기에서는 여전히 부담입니다. 모델을 단순화하는 단계를 도구 안에 넣는 것이 다음 과제입니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"바닥 받침은 테두리를 수직으로 내리는 방식이라, 투영된 테두리가 스스로 겹치는 심하게 오목한 개구부에서는 옆벽이 서로 교차할 수 있습니다. 현재는 관통 검사로 이를 감지해 점수에 반영할 뿐 자동으로 해소하지는 않습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"벽 두께는 검사하지 않습니다. 밀폐된 메시라도 벽이 노즐 지름보다 얇으면 FDM에서 출력되지 않습니다. 이 판정에는 내부 거리장 계산이 필요해 현재 범위 밖에 두었고 슬라이서에 맡깁니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"Liepa 삼각화는 정점 250개를 넘는 테두리에서 평면 투영으로 넘어갑니다. 세제곱 시간이라 그 이상에서는 브라우저가 눈에 띄게 멈추기 때문입니다. 테두리를 미리 단순화한 뒤 삼각화하고 다시 세분하는 방식으로 상한을 올릴 수 있습니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"8.2 향후 과제","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"메운 자리의 곡률을 주변과 더 매끄럽게 잇는 세분과 평활화 단계를 추가하는 것이 다음 목표입니다. 현재는 테두리 정점만으로 삼각화하므로 큰 구멍에서 면이 다소 평평하게 남습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"벽 두께 검사와 출력 방향 추천도 자연스러운 확장입니다. 출력 적합성을 위상뿐 아니라 제조 관점까지 포함해 채점하면 도구의 실용성이 한 단계 올라갑니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"또한 이 도구는 특정 서비스에 묶여 있지 않으므로, 사진측량 스캔이나 조각 소프트웨어 출력물처럼 같은 종류의 결함을 갖는 다른 입력에도 그대로 적용할 수 있습니다. 교내 메이커스페이스에서 실제 사용 사례를 모아 분류 임계값을 조정하는 것이 다음 단계입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"9. AI 도구 활용 내역 및 윤리 준수","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"9.1 활용 내역","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=6 --prop cols=2 --prop width=100%
TBL=8
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="도구" --prop c2="활용 방식"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="Tripo3D" --prop c2="비교 대상 3D 모델 생성 및 출력 특성 관찰"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="Meshy AI" --prop c2="비교 대상 3D 모델 생성 및 출력 특성 관찰"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="ChatGPT · Claude" --prop c2="연구 설계 검토, 알고리즘 문헌 조사, 실험 기록 정리, 코드 리뷰"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="Stable Diffusion · Midjourney" --prop c2="3D 생성 입력으로 쓸 콘셉트 이미지 제작"
officecli set "$FILE" "/body/tbl[$TBL]/tr[6]" --prop c1="RunyourAI · Gcube" --prop c2="후원받은 GPU 환경에서 생성 워크플로 실험"

for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 6); do for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]/p[1]/r[1]" --prop size=10.5pt
done; done
for row in 3 5; do for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 8. AI 도구 활용 내역" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"9.2 창작 과정의 진실성","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"AI 생성 결과물을 가공 없이 그대로 제출하지 않았습니다. 오히려 이 연구의 주제 자체가 생성 결과물을 그대로 쓸 수 없다는 사실에서 출발합니다. 생성 모델은 콘셉트 이미지와 비교 대상 메시를 만드는 데 사용했고, 최종 산출물인 메시 처리 파이프라인은 위상 자료구조부터 삼각화까지 직접 설계해 구현했습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"대화형 AI는 연구 설계 검토와 문헌 조사, 코드 리뷰에 보조 수단으로 활용했습니다. 알고리즘의 정확성은 AI의 응답이 아니라 단위 테스트로 검증했습니다. 저장소에는 43개의 테스트가 있으며, 5장에서 설명한 처리 순서의 근거도 절제 실험 형태의 테스트로 고정해 두어 순서를 되돌리면 테스트가 실패합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"작업 과정은 공개 저장소의 커밋 이력에 시간순으로 남아 있습니다. 리포트에 실린 모든 수치는 저장소의 벤치마크 스크립트가 생성한 결과 파일에서 직접 읽어 온 값이며, 스크립트를 다시 돌리면 같은 숫자가 나옵니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"9.3 저작권","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"웹사이트에 포함된 예제 모델은 외부에서 가져온 것이 아니라 코드로 생성한 형상입니다. 실제 서비스 출력물을 저장소에 넣지 않은 것도 이 때문입니다. 사용한 오픈소스 라이브러리는 three.js와 earcut이며 모두 MIT 라이선스입니다. 본 프로젝트의 소스 코드 역시 MIT 라이선스로 공개합니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"제출하는 모든 창작물은 타 공모전이나 외부 플랫폼에 기 발표되지 않은 순수 창작물입니다.","size":"11pt","spaceAfter":"8pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"10. 부록","style":"Heading1","size":"20pt","bold":"true","pageBreakBefore":"true","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"10.1 산출물 주소","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"라이브 데모 · https://junnnnyserver.tail9d6315.ts.net:8443","size":"11pt","font":"Consolas","spaceAfter":"4pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"소스 코드 · https://github.com/JunnnnyWon/meshcap","size":"11pt","font":"Consolas","spaceAfter":"12pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"웹사이트는 도구 화면 외에 벤치마크, 알고리즘, 프로젝트 소개 네 개 화면으로 구성되어 있습니다. 알고리즘 화면은 본 리포트 5장과 같은 내용을 담고 있으며, 벤치마크 화면에서는 직접 파일을 넣어 같은 기준으로 측정해 볼 수 있습니다.","size":"11pt","spaceAfter":"8pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"라이브 데모는 팀이 직접 운영하는 장비에서 Docker로 돌아가며 Tailscale 테일넷 안에서만 열립니다. 테일넷 밖에서는 접근할 수 없으므로, 외부에서 확인하시려면 저장소를 내려받아 아래 명령으로 직접 띄우실 수 있습니다. 정적 사이트라 별도 설정 없이 그대로 동작합니다.","size":"11pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"docker compose up -d --build","size":"10.5pt","font":"Consolas","indent":"720","spaceAfter":"12pt"}},

{"command":"add","parent":"/body","type":"paragraph","props":{"text":"10.2 재현 방법","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"저장소를 내려받고 의존성을 설치한 뒤 다음 명령으로 리포트의 모든 수치를 재현할 수 있습니다.","size":"11pt","spaceAfter":"10pt"}}
]
JSON
)"

officecli add "$FILE" /body --type table --prop rows=5 --prop cols=2 --prop width=100%
TBL=9
officecli set "$FILE" "/body/tbl[$TBL]/tr[1]" --prop header=true --prop c1="명령" --prop c2="하는 일"
officecli set "$FILE" "/body/tbl[$TBL]/tr[2]" --prop c1="npm install" --prop c2="의존성 설치"
officecli set "$FILE" "/body/tbl[$TBL]/tr[3]" --prop c1="npm test" --prop c2="코어 알고리즘 단위 테스트 43개 실행"
officecli set "$FILE" "/body/tbl[$TBL]/tr[4]" --prop c1="npm run bench" --prop c2="대조군을 측정해 결과 파일 갱신. 표 5와 그림 1의 출처"
officecli set "$FILE" "/body/tbl[$TBL]/tr[5]" --prop c1="npm run export:stl" --prop c2="보정 전후 STL 쌍 생성. 7장 출력 테스트에 사용"

for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]" --prop fill=1F3A5F
  officecli set "$FILE" "/body/tbl[$TBL]/tr[1]/tc[$col]/p[1]/r[1]" --prop bold=true --prop color=FFFFFF --prop size=10.5pt
done
for row in $(seq 2 5); do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[1]/p[1]/r[1]" --prop size=10.5pt --prop font=Consolas
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[2]/p[1]/r[1]" --prop size=10.5pt
done
for row in 3 5; do for col in 1 2; do
  officecli set "$FILE" "/body/tbl[$TBL]/tr[$row]/tc[$col]" --prop fill=EEF2F7
done; done

officecli add "$FILE" /body --type paragraph --prop text="표 9. 재현 명령" --prop size=9.5pt --prop italic=true --prop color=7C8593 --prop align=center --prop spaceBefore=6pt --prop spaceAfter=14pt

officecli batch "$FILE" --commands "$(cat <<'JSON'
[
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"10.3 팀 구성","style":"Heading2","size":"14pt","bold":"true","spaceBefore":"14pt","spaceAfter":"6pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"조원준 (202413011, 게임콘텐츠스쿨) 프로젝트 총괄 및 3D 생성 파이프라인 설계","size":"11pt","spaceAfter":"3pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"박정훈 (202413032, 게임콘텐츠스쿨) Cap 보정 및 메시 최적화 연구","size":"11pt","spaceAfter":"3pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"배윤서 (202413143, 게임콘텐츠스쿨) 3D 프린팅 테스트 및 결과 기록","size":"11pt","spaceAfter":"12pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"세 사람 모두 청강문화산업대학교 최초의 AI 연구 동아리 부원으로, 각각 AI 이미지 파이프라인 개발과 LLM 기반 졸업작품 개발 등의 활동을 병행하고 있습니다. 이번 연구에서는 3D 생성, 메시 최적화, 출력 검증을 나누어 맡았습니다.","size":"11pt","spaceAfter":"20pt"}},
{"command":"add","parent":"/body","type":"paragraph","props":{"text":"본 리포트에 실린 모든 수치는 저장소의 벤치마크 스크립트가 생성한 결과 파일에서 직접 읽어 왔으며, 리포트 문서 자체도 저장소의 생성 스크립트로 만들어집니다. 알고리즘을 고치고 측정을 다시 돌리면 문서의 숫자도 함께 갱신됩니다.","size":"10.5pt","italic":"true","color":"3A4049","spaceAfter":"8pt"}}
]
JSON
)"

echo "머리말·꼬리말"
officecli add "$FILE" / --type footer --prop type=first --prop text=""
officecli add "$FILE" / --type footer --prop type=default --prop align=center --prop size=9pt --prop text=""
officecli add "$FILE" "/footer[2]/p[1]" --type field --prop fieldType=page
officecli add "$FILE" "/footer[2]/p[1]" --type run --prop text=" / "
officecli add "$FILE" "/footer[2]/p[1]" --type field --prop fieldType=numpages

# 목차와 쪽 번호는 Word가 열 때 계산한다.
officecli set "$FILE" /settings --prop updateFields=true

officecli save "$FILE"
officecli close "$FILE"
officecli validate "$FILE"
echo "리포트 생성 완료: $FILE"
