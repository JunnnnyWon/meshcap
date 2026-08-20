import type { ReactNode } from 'react';
import rawResults from '../bench/results.json';
import { VARIANT_LABEL, type BenchmarkFile } from '../bench/schema.ts';
import { Badge } from '../components/ui.tsx';

const data = rawResults as BenchmarkFile;
const bust = data.models.find((m) => m.id === 'syn-bust');
const splitOnly = data.models.find((m) => m.id === 'syn-split-only');
const worst = data.models.find((m) => m.id === 'syn-worst');

/** 분류기가 실제로 메운 구멍 수. 정렬 전 테두리 개수와 비교하기 위한 값이다. */
const filledHoles = (id: string): number => {
  const model = data.models.find((m) => m.id === id);
  if (!model) return 0;
  return Object.values(model.strategyCounts).reduce((sum, n) => sum + n, 0);
};

export function MethodPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <article className="mx-auto max-w-[880px] px-6 py-12">
        <header className="mb-10 pb-8 border-b border-ink-800">
          <div className="label-caps mb-3">청강문화산업대학교 · 2026 청강 AI 크리에이티브 부스트</div>
          <h1 className="text-[28px] leading-[1.3] font-semibold tracking-[-0.02em] text-ink-100">
            MeshCap: 생성형 3D 메시 구멍을 찾아 메우고
            <br />
            출력해도 되는지 점수로 재는 방법
          </h1>
          <p className="mt-5 text-[13.5px] leading-relaxed text-ink-300">
            조원준<sup className="text-ink-500 text-[10px] ml-0.5">1</sup> · 박정훈
            <sup className="text-ink-500 text-[10px] ml-0.5">1</sup> · 배윤서
            <sup className="text-ink-500 text-[10px] ml-0.5">1</sup>
          </p>
          <p className="mt-1.5 text-[12px] text-ink-500">
            <sup>1</sup>청강문화산업대학교 게임콘텐츠스쿨
          </p>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-400">
            키워드: 구멍 메우기, 생성형 3D, 비다양체, half-edge, 3D 프린팅, 브라우저 기하 처리
          </p>
        </header>

        <Section number="초록" title="Abstract">
          <p>
            생성형 3D 서비스가 내놓는 삼각형 메시는 화면에서는 닫혀 보이지만, 슬라이서가 요구하는
            밀폐와 다양체 조건은 자주 깨집니다. UV 이음매에서 정점이 중복되고 면의 감는 방향이
            뒤섞이며, 비다양체 에지에서는 흔히 쓰는 경계 정의가 순회를 잃습니다. MeshCap은 처리
            순서를 바꿉니다. 공간 해시 용접으로 거짓 경계를 없애고, 면 방향을 맞춘 다음, 면이
            하나인 에지만으로 메울 구멍을 복원합니다. 면이 셋 이상인 에지에서 고립된 여분을
            떼고, 열린 테두리 끝점은 가까운 끝점과 붙입니다. 구멍마다 둘레, 평면성, 방향을 재서
            부채꼴, 평면 투영, Liepa 동적계획, 바닥 받침, 미세 붕괴 중 하나를 고릅니다. 면이 이미
            둘인 에지에는 뚜껑을 붙이지 않습니다. 밀폐, 다양체, 법선, 관통은
            100점으로 환산합니다. 코어는 three.js에 의존하지 않는 TypeScript라 브라우저 워커와 연산
            서버가 같은 숫자를 냅니다.
          </p>
          <p>
            단계를 하나씩 뺀 실험에서, 용접만으로 닫히는 구는 45점에서 100점이 됩니다. 뒤집힌 면이
            섞인 회전체는 아무 구멍이나 부채꼴로 메우면 {bust?.variants.naiveFan.score ?? 75}점에
            머물고, MeshCap은 {bust?.variants.meshcap.score ?? 100}점에 도달합니다. 3D AI A 출력 309만
            삼각형은 브라우저에서 약 7초 만에 경계 에지 120개가 0개가 되어 94점에서 96점으로
            올랐습니다. 3D AI B 190만 삼각형은 97점에서 99점입니다. 표면을 닫는 일과 다양체로 만드는
            일이 충돌할 수 있어, 채점에서 두 항목을 나눴습니다. 현재 파이프라인은 비다양체 에지를
            먼저 분리하고, 면이 둘인 에지에는 뚜껑을 거부합니다.
          </p>
        </Section>

        <Section number="1" title="서론">
          <p>
            텍스트나 이미지로 캐릭터를 생성하면 미리보기에는 충분합니다. 프린터로 보내는 순간이
            다릅니다. 슬라이서는 법선으로 안팎을 보기 때문에 액와부나 헤어 클러스터, 베이스처럼 열린
            자리의 속을 채우지 못합니다. MeshLab이나 Instant Meshes, 클라우드 리토폴로지는 데스크톱이나
            서버에 묶여 있어서 생성 파이프라인 한가운데 넣기 어렵습니다.
          </p>
          <p>
            MeshCap은 그 앞단을 브라우저에서 처리합니다. UV 이음매에서 생긴 거짓 경계를 용접으로
            없애고, 면 방향을 맞춘 뒤, 짝이 없는 half-edge로 구멍을 찾습니다. &ldquo;한 면만 접한
            에지&rdquo;로는 순회가 끊기는 지점을 이 정의로 피합니다. 구멍마다 메우는 방법을 다르게
            고르고, 슬라이서가 실패하는 순서에 맞춰 100점으로 채점합니다. 같은 코드를 브라우저와
            서버에서 돌려 3D AI 출력물 309만·190만 삼각형의 경계를 0으로 만들었습니다.
            용접을 빼면 구멍이 없는 구도 경계 수천 개로 잡힙니다. 그 순서가 점수에 미치는 영향은
            단계를 하나씩 뺀 실험으로 갈라 봤습니다.
          </p>
        </Section>

        <Section number="2" title="관련 연구">
          <p>
            구멍 메우기는 기하 처리에서 이미 많이 다룬 문제입니다. Liepa는 경계의 모든 삼각화 가운데 이면각과
            넓이를 사전식으로 최소화하는 동적계획을 제안했고, 이어서 Steiner 정점으로 밀도를 맞추고
            라플라시안 페어링으로 곡률을 이었습니다. MeshCap의 곡면 구멍은 이 전체 절차를 따릅니다 [1].
            Barequet와 Sharir는 결손 영역을 최소 넓이 삼각화로 메웠고 [2], Borodin은 열린 테두리 끝점을
            점진적으로 붙이는 갭 클로징을 제안했습니다 [6]. Attene의 MeshFix는 비다양체를 조합적
            다양체로 바꾼 뒤 구멍을 메웁니다 [3]. Guéziec는 시트를 찢어 다양체로 만드는 절단·봉합을
            정리했습니다 [7]. Carr와 Branch는 구멍 주변에 로컬 RBF를 맞춰 곡면을 보간했습니다 [8][9].
            MeshLab은 이 계열 필터를 대화형으로 묶어 두었습니다 [4].
          </p>
          <p>
            생성형 출력은 가정이 다릅니다. 정점이 UV 이음매에서 의도적으로 갈라져 있고, 면 방향이
            일관되지 않으며, 비다양체 에지가 테두리 한가운데 놓입니다. 전처리를 건너뛴 채 Liepa만
            돌리면 없는 구멍을 메우거나 순회가 끊깁니다. 브라우저에서 300만 삼각형을 다루려면 O(n³)
            단계를 작은 루프에만 쓰고, 나머지는 선형에 가까운 용접·추적에 맡겨야 합니다. 평면 다각형은
            earcut으로 삼각화합니다 [5]. 실험에 쓴 메시는 3D AI 출력물이며, 이 도구가 호출하는
            API가 아닙니다.
          </p>
        </Section>

        <Section number="3" title="방법">
          <p>
            입력은 좌표 배열과 삼각형 인덱스뿐입니다. 텍스처·재질·원본 파일은 파이프라인에 들어오지
            않습니다. 처리는 그림 1의 순서입니다.
          </p>

          <Pipeline />

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.1 정점 용접</h3>
          <p>
            생성형 서비스의 출력물은 UV seam과 머티리얼 경계마다 정점이 쪼개져 있습니다. 좌표는
            완전히 같은데 인덱스만 다릅니다. 이 상태에서 에지를 세면 이음매를 사이에 둔 두 면이
            서로를 이웃으로 인식하지 못하고, 멀쩡히 붙어 있는 자리가 전부 경계 에지로 잡힙니다.
          </p>
          {splitOnly && (
            <Callout>
              대조군 <strong>{splitOnly.label}</strong>은 실제로는 구멍이 하나도 없는 닫힌 모델입니다.
              그런데 용접 전에는 경계 에지가{' '}
              <Mono>{splitOnly.variants.raw.boundaryEdges.toLocaleString('ko-KR')}개</Mono>로 잡혀
              점수가 <Mono>{splitOnly.variants.raw.score}점</Mono>에 머무릅니다. 좌표가 같은 정점을
              합치기만 해도 <Mono>{splitOnly.variants.weldOnly.score}점</Mono>이 됩니다. 이 구간에서
              메운 구멍은 하나도 없습니다.
            </Callout>
          )}
          <p>
            병합 반경은 bbox 대각선의 1e-6배로 잡습니다. float32의 유효 자릿수를 고려한 값이라,
            모델의 실제 크기와 무관하게 같은 판정을 냅니다. 이 단계에서 미참조 정점, 면적이 0인
            삼각형, 완전히 겹친 중복 삼각형, NaN 좌표를 참조하는 삼각형도 함께 걷어냅니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.2 짝 없는 half-edge 루프</h3>
          <p>
            구멍의 테두리는 &ldquo;한 면만 접한 에지&rdquo;를 모으는 것으로 충분해 보입니다. 실제
            모델에서는 그렇지 않습니다. 면 셋이 한 에지를 공유하는 비다양체 지점이 있으면 그 에지는
            어느 정의로도 경계가 아닌데, 테두리를 따라가던 순회는 바로 그 자리에서 갈 곳을 잃습니다.
            끊긴 테두리는 어디까지가 구멍인지 확정할 수 없어 메울 수 없습니다.
          </p>
          <p>
            그래서 MeshCap은 기준을 바꿔, <strong className="text-ink-100">반대 방향 짝을 찾지
            못하고 남은 half-edge</strong>를 모읍니다. 삼각형 하나는 각 정점에 진입 하나와 진출
            하나를 주므로 처음부터 모든 정점에서 차수가 균형을 이룹니다. 반대 방향끼리 짝을 지우는
            연산은 양쪽 차수를 똑같이 줄이므로 균형이 그대로 유지됩니다. 균형 잡힌 유향 그래프는
            반드시 서로소인 순환들로 분해되므로, 이렇게 모으면 순회가 어디서도 끊기지 않습니다.
          </p>
          <p>
            실제 3D AI 출력물에서 이 차이가 결정적입니다. 3D AI 캐릭터 하나에는 비다양체
            에지가 93개 있었는데, 기존 정의로는 경계 정점 178개 중 117개에서 차수가 어긋나 테두리가
            전부 끊긴 사슬로 잡혔습니다. 짝이 없는 half-edge를 기준으로 바꾸자 같은 모델의 테두리
            59개가 모두 닫혔습니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.3 법선 정렬을 탐지보다 앞에 두는 이유</h3>
          <p>
            테두리를 짝 없는 half-edge로 정의하고 나면, 감는 방향이 뒤집힌 면이 곧바로 문제를
            일으킵니다. 뒤집힌 면은 자기 에지 세 개에서 방향 짝을 깨뜨립니다. 그 자리는 멀쩡히
            막혀 있는데도 짝을 찾지 못한 half-edge가 남으므로, 탐지기 눈에는 구멍으로 보입니다.
          </p>
          <p>
            그대로 메우면 없는 구멍을 막게 됩니다. 실제로는 막혀 있는 표면 위에 면이 한 겹 더
            덧붙어 부피가 달라지고 비다양체 에지가 늘어납니다. 구멍을 못 메우는 것보다 나쁩니다.
          </p>
          {bust && (
            <Callout>
              대조군 <strong>{bust.label}</strong>에 뒤집힌 면을 섞어 두었습니다. 정렬하지 않으면
              테두리가 <Mono>{bust.variants.weldOnly.holes}개</Mono>로 잡히지만, 방향을 맞추고 나면
              실제 구멍은 <Mono>{filledHoles('syn-bust')}개</Mono>뿐입니다. 나머지는 전부 뒤집힌 면이
              만든 허상입니다. 점수도 <Mono>{bust.variants.naiveFan.score}점</Mono>과{' '}
              <Mono>{bust.variants.meshcap.score}점</Mono>으로 갈립니다.
            </Callout>
          )}
          <p>
            다만 방향 통일과 <em className="text-ink-200 not-italic">바깥 방향 맞추기</em>는 다른
            일입니다. 이웃 면끼리 방향을 맞추는 전파는 열린 메시에서도 되지만, 껍질이 안팎 중 어디를
            향하는지는 부호 있는 부피로 판정하므로 닫힌 뒤에야 의미가 있습니다. 그래서 전파는 앞에,
            바깥 방향 판정은 구멍을 다 메운 뒤에 둡니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.4 비다양체 분리와 갭 클로징</h3>
          <p>
            구멍 분류에 들어가기 전에 두 가지를 먼저 합니다. 면이 셋 이상 모인 에지에서 고립된
            여분 삼각형을 제거하고, 나비넥타이처럼 팬이 둘인 정점은 복제해 시트를 나눕니다.
            머리카락처럼 큰 교차 시트는 통째로 떨어지므로 그대로 두고, 면이 둘인 에지에는
            뚜껑을 붙이지 않습니다. 그 다음 열린 테두리의 끝점끼리, 거의 겹친 평행 경계끼리,
            끝점과 맞은편 에지를 가까운 거리 안에서 붙입니다. 메우기는 면이 하나인 테두리만
            대상으로 합니다.
          </p>
          <p>
            닫히지 않은 테두리는 끝점을 공간 해시로 모아, 국소 평균 에지 길이의 두 배(bbox 대각선의
            1%를 넘지 않음) 안에서 법선이 어긋나지 않는 끝점끼리 병합합니다. 남은 끝점은 다른 경계
            에지에 스냅합니다. 새 채움 알고리즘이 아니라, 기존 분류기가 받을 수 있는 닫힌 루프를
            늘리는 전처리입니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.5 구멍 분류</h3>
          <p>
            모든 구멍을 같은 방법으로 메우면 반드시 어딘가가 망가집니다. 피규어 바닥의 큰 개구부를
            부채꼴로 메우면 가운데가 원뿔처럼 솟아 서포트가 붙고, 반대로 헤어 클러스터 사이의 작은 개구를
            평면으로 메우면 표면 밖으로 튀어나옵니다.
          </p>

          <div className="my-6 rounded-lg border border-ink-800 overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60">
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">조건</th>
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">전략</th>
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">근거</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                <StrategyRow
                  condition="테두리가 닫히지 않음"
                  strategy="갭 클로징 후 재분류"
                  reason="끝점이 가까우면 붙여 닫힌 루프로 승격. 그래도 안 닫히면 건너뜀"
                />
                <StrategyRow
                  condition="둘레가 아주 짧은 진짜 구멍"
                  strategy="미세 붕괴"
                  reason="삼각형을 넣지 않고 테두리 점을 한 점으로 모음"
                />
                <StrategyRow condition="정점 3개" strategy="단일 삼각형" reason="삼각형 하나로 정확히 닫힘" />
                <StrategyRow
                  condition="아래를 향한 큰 개구부"
                  strategy="바닥 받침"
                  reason="베드에 평평하게 닿아야 첫 층이 뜨지 않음"
                />
                <StrategyRow condition="정점 8개 이하" strategy="부채꼴" reason="중심점이 표면에서 멀지 않음" />
                <StrategyRow
                  condition="평면성 0.06 미만"
                  strategy="평면 투영"
                  reason="오목한 다각형도 정확히 채우고 새 정점을 만들지 않음"
                />
                <StrategyRow
                  condition="정점 250개 이하"
                  strategy="Liepa DP"
                  reason="주변 곡률을 이어받아 자연스럽게 채움"
                />
                <StrategyRow
                  condition="그 밖"
                  strategy="평면 투영으로 폴백"
                  reason="O(n³)이라 응답성을 우선함"
                />
              </tbody>
            </table>
          </div>

          <p>
            평면성은 테두리 정점이 최적 평면에서 벗어난 RMS 거리를, 둘레가 같은 원의 반지름으로 나눈
            무차원 값입니다. 모델의 크기나 단위와 무관하게 같은 기준으로 판정하기 위한 정규화입니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.6 메우기</h3>
          <div className="space-y-5">
            <Strategy name="부채꼴" tone="neutral">
              테두리 중심에 정점 하나를 두고 방사형으로 잇습니다. 가장 빠르지만 구멍이 커지면 중심점이
              표면에서 멀어져 원뿔처럼 솟습니다. 그래서 작은 구멍에만 씁니다.
            </Strategy>
            <Strategy name="평면 투영" tone="patch">
              테두리의 최적 평면을 Newell 방법으로 구하고, 그 평면에 투영해 earcut으로 삼각화합니다.
              새 정점을 만들지 않으므로 표면 밖으로 솟지 않고, 오목한 다각형도 올바르게 채웁니다.
            </Strategy>
            <Strategy name="Liepa DP + 세분·페어링" tone="amber">
              테두리를 채우는 모든 삼각화 중 <em className="not-italic text-ink-200">(이웃 면과 이루는
              최대 이면각, 총 넓이)</em>를 사전식으로 최소화하는 것을 동적계획법으로 찾습니다. 이어서
              주변 평균 에지 길이보다 큰 삼각형의 무게중심에 Steiner 정점을 넣고, 내부 정점을
              이중 라플라시안으로 풀어 주변 곡률을 잇습니다. 큰 비평면 구멍은 2-링에 맞춘 로컬
              다조화 RBF의 제로 레벨로 Steiner 정점을 한 번 더 투영합니다.
            </Strategy>
            <Strategy name="미세 붕괴" tone="neutral">
              둘레가 모델에 비해 아주 짧은 진짜 구멍은 삼각형을 넣지 않습니다. 테두리 정점을
              무게중심으로 모아 핀홀을 없앱니다. 면이 이미 둘인 가짜 구멍에는 쓰지 않습니다.
            </Strategy>
            <Strategy name="바닥 받침" tone="patch">
              테두리를 같은 높이의 평면까지 수직으로 내려 옆벽을 만들고, 그 평면 링을 채웁니다. 기존
              정점은 하나도 움직이지 않아 실루엣이 그대로 유지됩니다. 평면은 테두리 최저점보다 한 층
              두께만큼 더 아래에 둡니다. 같은 높이에 두면 최저점의 옆벽 삼각형이 면적 0이 되어 오히려
              새 결함이 생기기 때문입니다.
            </Strategy>
          </div>
          <p className="mt-5">
            어떤 전략이든 삼각형을 하나도 내놓지 못하면 부채꼴로 폴백합니다. 자기교차하는 테두리처럼
            병적인 입력에서 품질을 조금 포기하더라도 구멍이 남는 것보다는 낫기 때문입니다. 다만 그
            부채꼴이 면이 둘인 에지에 네 번째 면을 붙이게 되면 거절합니다. 뚜껑이 새 틈을 남기면
            루프 집합이 줄지 않을 때까지 최대 네 번 반복합니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.7 출력 적합성 채점</h3>
          <p>
            배점은 슬라이서가 실제로 실패하는 순서를 따랐습니다. 경계 에지가 남으면 아예 슬라이싱이
            되지 않으므로 가장 무겁고, 뒤로 갈수록 출력은 되지만 품질이 떨어지는 항목입니다. 한 항목에
            결함이 있으면 그 항목은 만점을 받을 수 없습니다.
          </p>
          <div className="my-6 space-y-2">
            <ScoreRow label="완전 밀폐" points={35} note="열린 경계가 하나도 없는 상태" />
            <ScoreRow label="다양체 위상" points={25} note="세 면 이상이 만나는 에지나 정점이 없음" />
            <ScoreRow label="법선 방향" points={15} note="모든 면이 같은 방향으로 정렬" />
            <ScoreRow label="단일 껍질" points={10} note="떠 있는 조각이 없음" />
            <ScoreRow label="삼각형 품질" points={10} note="면적이 0에 가까운 삼각형이 없음" />
            <ScoreRow label="뚜껑 관통" points={5} note="새로 만든 면이 기존 표면을 뚫지 않음" />
          </div>
          <p>
            관통 검사는 메시 전체가 아니라 새로 만든 뚜껑만 대상으로 합니다. 실제로 문제가 되는 것은
            우리가 방금 집어넣은 면이고, 균일 격자에 삼각형을 넣어 같은 칸에 든 후보끼리만 분리축
            검사를 하면 뚜껑 개수에 비례하는 비용으로 끝나기 때문입니다.
          </p>
        </Section>

        <Section number="4" title="실험">
          <h3 className="text-[15px] font-medium text-ink-100 mb-3">4.1 단계를 하나씩 뺀 실험</h3>
          <p>
            같은 모델에 네 가지를 돌려 봅니다. 원본, 용접만, 용접한 뒤 구멍을 전부 부채꼴로 메운 것,
            MeshCap 전체. 용접에서 점수가 오르면 그 구멍은 처음부터 없던 겁니다. 부채꼴에서 멈추고
            MeshCap에서만 만점이면 분류와 방향 맞추기가 필요한 구멍입니다.
          </p>

          <div className="my-6 rounded-lg border border-ink-800 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60">
                  <th className="text-left font-normal text-ink-400 px-3 py-2.5">모델</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.raw}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.weldOnly}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.naiveFan}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.meshcap}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">밀폐</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                {data.models.map((model) => (
                  <tr key={model.id} className="border-b border-ink-800/60 last:border-0">
                    <td className="px-3 py-2 align-top text-ink-100">
                      {model.label}
                      <div className="text-[11px] text-ink-500 mt-0.5">{model.concept}</div>
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {model.variants.raw.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {model.variants.weldOnly.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {model.variants.naiveFan.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono text-ink-100">
                      {model.variants.meshcap.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right">
                      {model.variants.meshcap.watertight ? '예' : '아니오'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            {splitOnly && (
              <>
                {splitOnly.label}은 용접만으로 만점입니다. 메운 구멍이 없습니다.{' '}
              </>
            )}
            {bust && (
              <>
                {bust.label}은 용접 뒤에도 테두리 {bust.variants.weldOnly.holes}개가 남고, 부채꼴은{' '}
                {bust.variants.naiveFan.score}점·비다양체 에지 {bust.variants.naiveFan.nonManifoldEdges}개로
                끝납니다. MeshCap은 분류기 기준 {filledHoles('syn-bust')}개를 메워{' '}
                {bust.variants.meshcap.score}점, 비다양체 0입니다.{' '}
              </>
            )}
            {worst && (
              <>
                {worst.label}처럼 결함을 겹쳐 두면 MeshCap도 {worst.variants.meshcap.score}점에
                머뭅니다. 밀폐는 되지만 비다양체 에지 {worst.variants.meshcap.nonManifoldEdges}개가
                남습니다.
              </>
            )}
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">4.2 3D AI 출력물</h3>
          <p>
            같은 코어를 브라우저 워커에서 3D AI STL에 적용했습니다. 원본 파일은 전송하지
            않았습니다. 아래 수치는 이 도구로 측정한 값입니다.
          </p>

          <div className="my-6 rounded-lg border border-ink-800 overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60">
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5" />
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">3D AI A</th>
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">3D AI B</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                <tr className="border-b border-ink-800/60">
                  <td className="px-4 py-2">삼각형</td>
                  <td className="px-4 py-2 font-mono">3,092,042</td>
                  <td className="px-4 py-2 font-mono">1,896,054</td>
                </tr>
                <tr className="border-b border-ink-800/60">
                  <td className="px-4 py-2">파일</td>
                  <td className="px-4 py-2 font-mono">147 MB</td>
                  <td className="px-4 py-2 font-mono">90 MB</td>
                </tr>
                <tr className="border-b border-ink-800/60">
                  <td className="px-4 py-2">점수</td>
                  <td className="px-4 py-2 font-mono">94 → 96</td>
                  <td className="px-4 py-2 font-mono">97 → 99</td>
                </tr>
                <tr className="border-b border-ink-800/60">
                  <td className="px-4 py-2">경계 에지</td>
                  <td className="px-4 py-2 font-mono">120 → 0</td>
                  <td className="px-4 py-2 font-mono">14 → 0</td>
                </tr>
                <tr className="border-b border-ink-800/60">
                  <td className="px-4 py-2">밀폐</td>
                  <td className="px-4 py-2">watertight</td>
                  <td className="px-4 py-2">watertight</td>
                </tr>
                <tr>
                  <td className="px-4 py-2">브라우저</td>
                  <td className="px-4 py-2 font-mono">약 7초</td>
                  <td className="px-4 py-2 font-mono">약 4–10초</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p>
            두 모델 모두 밀폐됩니다. 만점이 아닌 점도 점수에 남겼습니다. 3D AI B는 구멍을 메운
            뒤 비다양체 에지가 9개에서 90개로 늘었습니다. 면 셋이 이미 공유하던 자리에 네 번째 면을
            붙인 결과입니다. 표면을 닫는 일과 다양체로 만드는 일이 충돌했고, 채점에서 두 항목을
            갈라 두었습니다.
          </p>
        </Section>

        <Section number="5" title="한계와 결론">
          <ul className="space-y-2.5 list-none pl-0">
            <Limitation>
              테두리가 한 정점에서 여러 갈래로 갈라지면 어느 갈래를 먼저 따라가느냐에 따라 구멍이
              나뉘는 모양이 달라집니다. 순회가 반드시 닫히고 전체를 빠짐없이 덮는다는 점은
              보장되지만, 분할 결과가 유일하지는 않습니다.
            </Limitation>
            <Limitation>
              면 셋이 공유하던 에지는 시트를 정점 복제로 먼저 찢고, 그래도 면이 둘인 자리에는 뚜껑을
              붙이지 않습니다. 가짜 구멍을 메워 비다양체가 늘어나던 경로는 막았지만, 이미 있던
              비다양체 정점(나비넥타이)까지 없애지는 않습니다.
            </Limitation>
            <Limitation>
              겹쳐 있는 이중 표면은 같은 자리에 테두리가 두 벌 잡히고 뚜껑도 두 겹으로 생깁니다.
              입력 자체의 병리라 현재는 감지해 점수에만 반영하고 자동으로 정리하지는 않습니다.
            </Limitation>
            <Limitation>
              바닥 받침은 테두리를 수직으로 내리므로, 투영된 테두리가 스스로 겹치는 심하게 오목한
              개구부에서는 옆벽이 서로 교차할 수 있습니다.
            </Limitation>
            <Limitation>
              벽 두께는 검사하지 않습니다. 밀폐된 메시라도 벽이 노즐 지름보다 얇으면 FDM에서 출력되지
              않습니다. 이 판정은 슬라이서에 맡깁니다.
            </Limitation>
            <Limitation>
              Liepa 삼각화는 정점 250개를 넘는 테두리에서 평면 투영으로 넘어갑니다. O(n³)이라 그
              이상에서는 브라우저가 눈에 띄게 멈추기 때문입니다. 삼각형 300만 개 규모에서는 처리에
              약 7초, 메모리 1.4GB가 필요합니다.
            </Limitation>
          </ul>
          <p className="mt-6">
            생성형 메시가 출력에 실패하는 이유는 구멍만이 아닙니다. 이음매 정점, 뒤집힌 면, 비다양체
            지점이 구멍 탐지부터 속입니다. MeshCap은 그 전처리를 앞에 두고, 남은 구멍만 나눠
            메웁니다. 브라우저에서 서비스 출력물을 닫을 수 있다는 점은 확인했습니다. 닫기와 다양체를
            동시에 만족하지 못하는 입력은 점수에 그대로 남습니다.
          </p>
        </Section>

        <Section number="참고문헌" title="References">
          <ol className="list-decimal pl-5 space-y-2.5 text-[12.5px] leading-relaxed text-ink-400">
            <li>
              P. Liepa, &ldquo;Filling Holes in Meshes,&rdquo; in <em>Proc. Eurographics/ACM
              SIGGRAPH Symp. Geometry Processing</em>, 2003.
            </li>
            <li>
              G. Barequet and M. Sharir, &ldquo;Filling gaps in the boundary of a polyhedron,&rdquo;{' '}
              <em>Comput. Aided Geom. Des.</em>, vol. 12, no. 2, 1995.
            </li>
            <li>
              M. Attene, &ldquo;A lightweight approach to repairing digitized polygon meshes,&rdquo;{' '}
              <em>The Visual Computer</em>, vol. 26, 2010.
            </li>
            <li>
              P. Cignoni, M. Callieri, M. Corsini, M. Dellepiane, F. Ganovelli, and G. Ranzuglia,
              &ldquo;MeshLab: an Open-Source Mesh Processing Tool,&rdquo; in <em>Eurographics Italian
              Chapter Conf.</em>, 2008.
            </li>
            <li>
              Mapbox, &ldquo;earcut: Fast, memory-efficient triangulation library,&rdquo; GitHub
              repository.
            </li>
            <li>
              P. Borodin, M. Novotni, and R. Klein, &ldquo;Progressive Gap Closing for Mesh
              Repairing,&rdquo; in <em>Advances in Modelling, Animation and Rendering</em>, 2002.
            </li>
            <li>
              A. Guéziec, G. Taubin, F. Lazarus, and B. Horn, &ldquo;Cutting and Stitching: Converting
              Sets of Polygons to Manifold Surfaces,&rdquo; <em>IEEE Trans. Vis. Comput. Graphics</em>,
              vol. 7, no. 2, 2001.
            </li>
            <li>
              J. C. Carr et al., &ldquo;Reconstruction and Representation of 3D Objects with Radial
              Basis Functions,&rdquo; in <em>Proc. ACM SIGGRAPH</em>, 2001.
            </li>
            <li>
              J. Branch, F. Prieto, and P. Boulanger, &ldquo;Automatic Hole-Filling of Triangular
              Meshes Using Local RBF Interpolation,&rdquo; in <em>Proc. 3DPVT</em>, 2006.
            </li>
          </ol>
        </Section>
      </article>
    </div>
  );
}

function Pipeline() {
  const stages = [
    { label: '파일 로드', detail: 'GLB · OBJ · STL · PLY를 하나의 삼각형 목록으로' },
    { label: '정점 용접', detail: '공간 해시로 좌표가 같은 정점 병합' },
    { label: '법선 방향 통일', detail: '이웃 면끼리 감는 방향 전파' },
    { label: '비다양체 분리', detail: '면이 셋 이상인 에지를 시트마다 찢음' },
    { label: '갭 클로징', detail: '열린 테두리 끝점을 가까운 끝점·에지에 붙임' },
    { label: '위상 분석', detail: 'half-edge로 경계·비다양체·연결 요소 집계' },
    { label: '테두리 추적', detail: '면이 하나인 에지를 이어 메울 구멍만 복원' },
    { label: '구멍 분류', detail: '둘레 · 평면성 · 방향으로 전략 배정. 핀홀은 붕괴' },
  ];

  return (
    <div className="my-8 rounded-xl border border-ink-800 bg-ink-900/40 p-6">
      <div className="label-caps mb-5">그림 1. 처리 순서</div>

      <div className="space-y-0">
        {stages.map((stage, index) => (
          <div key={stage.label} className="flex gap-4">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-2 h-2 rounded-full bg-amber-accent mt-[7px]" />
              <div className="w-px flex-1 bg-ink-700 my-1" />
            </div>
            <div className="pb-4">
              <div className="text-[13.5px] text-ink-100">{stage.label}</div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">{stage.detail}</div>
            </div>
            <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">
              {String(index + 1).padStart(2, '0')}
            </span>
          </div>
        ))}

        <div className="flex gap-4">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-patch mt-[7px]" />
            <div className="w-px flex-1 bg-ink-700 my-1" />
          </div>
          <div className="pb-4 flex-1">
            <div className="text-[13.5px] text-ink-100">구멍 메우기</div>
            <div className="text-[11.5px] text-ink-400 mt-0.5">
              뚜껑이 또 다른 틈을 남기면 남지 않을 때까지 반복
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {['단일 삼각형', '부채꼴', '평면 투영', 'Liepa 세분', '바닥 받침', '미세 붕괴'].map((name) => (
                <Badge key={name} tone="patch">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">09</span>
        </div>

        {[
          { label: '바깥 방향 정렬', detail: '껍질별 부호 있는 부피로 안팎 판정', n: '10' },
          { label: '검증 및 채점', detail: '밀폐 · 다양체 · 관통 검사 후 100점 환산', n: '11' },
        ].map((stage, index, arr) => (
          <div key={stage.label} className="flex gap-4">
            <div className="flex flex-col items-center shrink-0">
              <div className="w-2 h-2 rounded-full bg-good mt-[7px]" />
              {index < arr.length - 1 && <div className="w-px flex-1 bg-ink-700 my-1" />}
            </div>
            <div className={index < arr.length - 1 ? 'pb-4' : ''}>
              <div className="text-[13.5px] text-ink-100">{stage.label}</div>
              <div className="text-[11.5px] text-ink-400 mt-0.5">{stage.detail}</div>
            </div>
            <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">{stage.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Section({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline gap-3 mb-4 pb-2.5 border-b border-ink-800">
        <span className="font-mono text-[11px] text-amber-accent">{number}</span>
        <h2 className="text-[17px] font-medium text-ink-100">{title}</h2>
      </div>
      <div className="space-y-4 text-[13.5px] leading-relaxed text-ink-300">{children}</div>
    </section>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border-l-2 border-amber-accent bg-ink-900/60 px-4 py-3.5 text-[13px] leading-relaxed text-ink-200">
      {children}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[12.5px] text-amber-accent">{children}</span>;
}

function StrategyRow({
  condition,
  strategy,
  reason,
}: {
  condition: string;
  strategy: string;
  reason: string;
}) {
  return (
    <tr className="border-b border-ink-800/60 last:border-0">
      <td className="px-4 py-2.5 align-top">{condition}</td>
      <td className="px-4 py-2.5 align-top text-ink-100 whitespace-nowrap">{strategy}</td>
      <td className="px-4 py-2.5 align-top text-ink-400 text-[12px]">{reason}</td>
    </tr>
  );
}

function Strategy({
  name,
  tone,
  children,
}: {
  name: string;
  tone: 'neutral' | 'patch' | 'amber';
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-3.5">
      <div className="mb-2">
        <Badge tone={tone}>{name}</Badge>
      </div>
      <p className="text-[13px] leading-relaxed text-ink-300">{children}</p>
    </div>
  );
}

function ScoreRow({ label, points, note }: { label: string; points: number; note: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[88px] shrink-0 text-[12.5px] text-ink-200">{label}</span>
      <div className="w-24 h-[6px] rounded-full bg-ink-850 overflow-hidden">
        <div className="h-full bg-amber-accent rounded-full" style={{ width: `${(points / 35) * 100}%` }} />
      </div>
      <span className="font-mono text-[12px] text-amber-accent w-7 text-right">{points}</span>
      <span className="text-[12px] text-ink-400">{note}</span>
    </div>
  );
}

function Limitation({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="text-ink-600 mt-[3px] shrink-0">—</span>
      <span>{children}</span>
    </li>
  );
}
