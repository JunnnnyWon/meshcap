import type { ReactNode } from 'react';
import rawResults from '../bench/results.json';
import { VARIANT_LABEL, type BenchmarkFile } from '../bench/schema.ts';
import { Badge } from '../components/ui.tsx';

const data = rawResults as BenchmarkFile;
const bust = data.models.find((m) => m.id === 'syn-bust');
const splitOnly = data.models.find((m) => m.id === 'syn-split-only');
const worst = data.models.find((m) => m.id === 'syn-worst');

/** 대조군의 변형별 평균 점수. */
const averageScore = (variant: 'raw' | 'meshcap'): number => {
  if (data.models.length === 0) return 0;
  const sum = data.models.reduce((acc, model) => acc + model.variants[variant].score, 0);
  return Math.round((sum / data.models.length) * 10) / 10;
};

/**
 * 3D AI 예제 측정값. 브라우저 전용 파일(Draco·텍스처)이라 벤치 스크립트가 아니라
 * 같은 코어를 직접 돌려 잰 값을 적는다.
 */
const AI_EXAMPLE_ROWS: { label: string; a: string; b: string }[] = [
  { label: '삼각형', a: '169,478', b: '177,035' },
  { label: '올린 그대로 점수', a: '61', b: '67' },
  { label: '겹친 모서리 (올린 그대로)', a: '52,007', b: '13,627' },
  { label: '관통 쌍 (올린 그대로)', a: '1만 이상', b: '1,789' },
  { label: '구멍 메우기', a: '56점 · 14초', b: '65점 · 11초' },
  { label: '솔리드화 (자동)', a: '100점 · 3.6초', b: '100점 · 2.7초' },
  { label: '솔리드화 한 스레드', a: '7.4초', b: '5.6초' },
  { label: '원래 모양 유지', a: '90.4%', b: '99.2%' },
  { label: '보정 후 삼각형', a: '768,232', b: '486,564' },
];

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
            MeshCap: 생성형 3D 메시를 출력할 수 있게 고치고
            <br />
            같은 잣대로 전후를 재는 방법
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
            키워드: 구멍 메우기, 일반화 와인딩 넘버, 솔리드화, 생성형 3D, 비다양체, 3D 프린팅, 브라우저 기하 처리
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
            부채꼴, 평면 투영, Liepa 동적계획, 전진 전면, 바닥 받침, 미세 붕괴 중 하나를 고르고,
            로컬이 못 닫은 테두리만 주위를 감싸 메웁니다.             면이 이미
            둘인 에지에는 뚜껑을 붙이지 않습니다. 뚜껑 뒤에 남는 1-면 찢김은 겹친 여분을 떼고,
            시트에 가까운 변은 새 정점만으로 얇은 띠를 붙입니다. 밀폐, 다양체, 법선, 관통은
            100점으로 환산합니다. 겹친 모서리와 면끼리의 관통이 많은 입력에는 두 번째 방법인
            솔리드화를 씁니다. 일반화 와인딩 넘버로 안팎을 다시 정하고, 두께 없는 면에 최소 두께를
            준 뒤, 사면체 분할 위에서 닫힌 표면을 새로 뽑습니다. 코어는 three.js에 의존하지 않는
            TypeScript라 브라우저 워커와 연산 서버가 같은 숫자를 냅니다.
          </p>
          <p>
            보정 전 점수는 올린 파일 그대로 잽니다. 좌표가 비트 단위로 같은 점만 합치고 면은 하나도
            빼지 않으며, 관통 검사도 보정 전후 모두 메시 전체에 합니다. 이 기준에서 합성 대조군
            {' '}{data.models.length}개는 평균 {averageScore('raw')}점에서 {averageScore('meshcap')}점이
            됩니다. 뒤집힌 면이 섞인 회전체는 아무 구멍이나 부채꼴로 메우면{' '}
            {bust?.variants.naiveFan.score ?? 60}점에 머물고, 구멍 메우기는{' '}
            {bust?.variants.patch.score ?? 100}점입니다. 결함을 겹친 구는 구멍 메우기로{' '}
            {worst?.variants.patch.score ?? 78}점, 솔리드화로 {worst?.variants.solid.score ?? 100}점입니다.
            3D AI 예제 두 개(17만 삼각형)는 겹친 모서리와 관통 때문에 구멍 메우기로는 오히려 점수가
            내려가고, 솔리드화로는 둘 다 100점이 됩니다(4.2절).
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
            고르고, 슬라이서가 실패하는 순서에 맞춰 100점으로 채점합니다. 겹친 면과 관통이 많은
            입력은 솔리드화로 부피를 다시 정합니다. 같은 코드를 브라우저와 서버에서 돌리고, 보정
            전후는 같은 잣대로 잽니다. 각 단계가 점수에 미치는 영향은 단계를 하나씩 뺀 실험으로
            갈라 봤습니다.
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
            MeshLab은 이 계열 필터를 대화형으로 묶어 두었습니다 [4]. Zhao는 전면 정점의 내각으로
            삼각형을 전진 생성하는 구멍 메우기를 제안했고 [10], MeshCap은 중형 비평면 구멍과 열린
            사슬에 그 축소판을 씁니다. 로컬 RBF는 정점 8개 이상이고 조금 휘어진 뚜껑까지 넓혀
            Steiner를 주변 곡면의 제로 레벨로 붙입니다. 로컬이 못 닫은 테두리는 그 AABB 안에서만
            occupancy를 만들고 바깥을 플러드한 뒤 마칭큐브로 막을 뽑습니다 [11][12]. 모델 전체를
            다시 만드는 전역 복셀은 쓰지 않습니다.
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
              대조군 <strong>{splitOnly.label}</strong>은 이음매마다 정점을 쪼개 둔 구입니다. 좌표가
              비트 단위로 같은 점은 올린 그대로 잴 때부터 합치므로, 이음매는 구멍으로 잡히지 않습니다.
              그래도 남쪽 극점에는 sin(π)가 정확히 0이 아니라서 1e-16만큼 벌어진 점들이 남아, 올린
              그대로는 열린 모서리 <Mono>{splitOnly.variants.raw.boundaryEdges.toLocaleString('ko-KR')}개</Mono>
              {' '}·<Mono>{splitOnly.variants.raw.score}점</Mono>입니다. 대각선의 1e-6배 안의 점까지
              합치는 용접을 거치면 <Mono>{splitOnly.variants.patch.score}점</Mono>이 됩니다.
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
              테두리가 <Mono>{bust.variants.raw.holes}개</Mono>로 잡히지만, 방향을 맞추고 나면
              실제 구멍은 <Mono>{filledHoles('syn-bust')}개</Mono>뿐입니다. 나머지는 전부 뒤집힌 면이
              만든 허상입니다. 점수도 <Mono>{bust.variants.naiveFan.score}점</Mono>과{' '}
              <Mono>{bust.variants.patch.score}점</Mono>으로 갈립니다.
            </Callout>
          )}
          <p>
            다만 방향 통일과 <em className="text-ink-200 not-italic">바깥 방향 맞추기</em>는 다른
            일입니다. 이웃 면끼리 방향을 맞추는 전파는 열린 메시에서도 되지만, 껍질이 안팎 중 어디를
            향하는지는 부호 있는 부피로 판정하므로 닫힌 뒤에야 의미가 있습니다. 그래서 전파는 앞에,
            바깥 방향 판정은 구멍을 다 메운 뒤에 둡니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.4 비다양체 분리, 갭 클로징, 남은 찢김</h3>
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
          <p>
            뚜껑을 붙인 뒤에도 면이 하나인 에지가 남을 수 있습니다. 고립된 여분 삼각형이 안쪽 면
            위에 겹치면 지우고, 양 끝이 시트에 닿은 채 가운데만 떠 있는 변은 안쪽 면에 새 정점을
            두고 얇은 띠로 잇습니다. 이미 면이 둘인 에지에는 세 번째 면을 올리지 않습니다. 시트에
            붙어 보이는 1-면은 보정 후 화면에서 찢김 윤곽으로 그리지 않습니다.
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
                  strategy="가상 닫힘 / 전진 전면"
                  reason="끝점이 국소 에지 몇 배 안이면 가상 에지로 닫아 기존 전략. 멀면 전면을 전진. skip은 최후"
                />
                <StrategyRow
                  condition="남은 1-면이 안쪽 시트에 겹침"
                  strategy="여분 면 삭제 · 틈 띠"
                  reason="고립 여분은 지움. 시트 위 활꼴은 새 정점만으로 띠를 붙임. 2-면 에지에는 세 번째 면을 안 올림"
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
                <StrategyRow
                  condition="정점 8개 이하 · 평면"
                  strategy="부채꼴"
                  reason="중심점이 표면에서 멀지 않음"
                />
                <StrategyRow
                  condition="정점 8개 이하 · 비평면"
                  strategy="Liepa DP"
                  reason="작은 구멍도 원뿔 대신 곡면을 따라 채움"
                />
                <StrategyRow
                  condition="평면성 0.06 미만"
                  strategy="평면 투영"
                  reason="정말 평평할 때만. 오목한 다각형도 새 정점 없이 채움"
                />
                <StrategyRow
                  condition="정점 9–250 · 비평면 · 닫힌 루프"
                  strategy="Liepa DP"
                  reason="주변 곡률을 이어받아 자연스럽게 채움"
                />
                <StrategyRow
                  condition="열린 사슬 · Liepa 상한 초과 비평면"
                  strategy="전진 전면"
                  reason="내각이 작은 귀부터 삼각형을 붙여 O(n³)을 피함. 9–400정점"
                />
                <StrategyRow
                  condition="정점 400 초과 비평면 · 로컬이 못 닫은 테두리"
                  strategy="로컬 복셀 랩"
                  reason="남은 테두리 AABB만 occupancy·플러드·마칭큐브·투영"
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
              최대 이면각, 총 넓이)</em>를 사전식으로 최소화하는 것을 동적계획법으로 찾습니다. 정점
              4개 이상 비평면 뚜껑은 전략과 무관하게 주변 평균 에지 길이보다 큰 삼각형의 무게중심에
              Steiner 정점을 넣고, 내부 정점을 코탄젠트 가중 이중 라플라시안으로 풀어 주변 곡률을
              잇습니다. 정점 8개 이상이고 조금 휘어진 구멍은 2-링에 맞춘 로컬 다조화 RBF의 제로
              레벨로 Steiner를 한 번 더 투영하고, 기존 표면을 뚫으면 클램프합니다. 바닥 받침은
              제외합니다.
            </Strategy>
            <Strategy name="전진 전면" tone="amber">
              전면 정점의 내각을 재서 75° 이하는 삼각형 하나, 135° 이하는 Steiner 하나, 그 이상은
              둘을 넣고 전면을 전진합니다. 9–400정점 비평면 구멍과 열린 사슬에 쓰고, 면이 둘인
              에지를 만들면 그 각만 건너뛴 뒤 Liepa·평면·부채꼴로 넘어갑니다.
            </Strategy>
            <Strategy name="로컬 복셀 랩" tone="patch">
              로컬 삼각화가 못 닫고 남은 테두리의 AABB와 여유칸에만 격자를 깝니다. 근처 삼각형
              occupancy를 팽창하고 바깥을 플러드한 뒤 마칭큐브로 막을 뽑고, 원본에 달라붙은 면은
              버리며 구멍 쪽 정점은 테두리에 스냅합니다. 브라우저는 96³, 연산 서버는 160³입니다.
              모델 전체를 다시 만들지 않습니다.
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
            <Strategy name="남은 찢김 부착" tone="patch">
              뚜껑 루프가 아닌 1-면 에지를 대상으로 합니다. 안쪽 면 위에 겹친 여분 삼각형은 지웁니다.
              양 끝이 시트 정점이고 가운데가 떠 있으면, 안쪽 면 위에만 새 정점을 두고 얇은 띠로
              잇습니다. 기존 2-면 에지를 띠의 변으로 쓰지 않아 비다양체가 늘지 않게 합니다. 시트에
              붙어 보이는 1-면은 보정 후 붉은 윤곽에서 뺍니다. 아래 시트가 없는 창은 그대로 둡니다.
            </Strategy>
          </div>
          <p className="mt-5">
            어떤 전략이든 삼각형을 하나도 내놓지 못하면 부채꼴로 폴백합니다. 자기교차하는 테두리처럼
            병적인 입력에서 품질을 조금 포기하더라도 구멍이 남는 것보다는 낫기 때문입니다. 시각
            부착 모드에서는 면이 둘인 에지에 걸리는 삼각형만 건너뛰고 패치 전체를 버리지는 않습니다.
            점수용 엄격 가드는 옵션으로 남깁니다. 뚜껑이 새 틈을 남기면 루프 집합이 줄지 않을 때까지
            최대 네 번 반복하고, 그래도 남은 테두리만 로컬 복셀 랩으로 넘깁니다.
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
            <ScoreRow label="면끼리 관통" points={5} note="메시 전체에서 서로 뚫고 지나가는 면이 없음" />
          </div>
          <p>
            보정 전 점수는 올린 파일 그대로 잽니다. 좌표가 비트 단위로 같은 점만 합치고, 면적이 0이
            되는 면은 위상에서 빼되 찌그러진 삼각형으로 셉니다. 허용오차 용접이나 중복 면 제거는
            보정의 일부로 봅니다. 같은 면이 반대 방향으로 두 번 든 양면 시트를 하나로 줄이면 그
            가장자리가 새 테두리가 되어, 올린 파일에 없던 구멍이 보정 전 점수에 잡히기 때문입니다.
          </p>
          <p>
            관통은 보정 전후 모두 메시 전체를 봅니다. 삼각형 AABB를 균일 격자에 넣고 (칸, 삼각형)
            키를 정렬해 같은 칸끼리만 분리축 검사를 합니다. 한 쌍은 두 AABB가 겹치는 영역의 최소
            모서리가 든 칸에서 한 번만 셉니다. 점을 공유하는 쌍과 같은 평면에서 겹친 쌍은 관통으로
            치지 않고, 1만 쌍을 찾으면 세기를 멈춥니다. 끝까지 검사하지 못하면 이 항목에 점수를 주지
            않습니다. 77만 삼각형 결과를 1초 안에 검사합니다.
          </p>
          <p>
            점수에 넣지 않는 지표가 하나 더 있습니다. 원래 바깥 표면 넓이 중 결과 표면에서 가장 긴
            축의 0.5% 안에 남은 비율입니다. 양쪽이 모두 안쪽인 면은 출력물에서 보이지 않으므로 따로
            셉니다. 솔리드화처럼 표면을 새로 뽑는 방법은 점수가 올라도 모양이 달라질 수 있어, 둘을
            나란히 보여 줍니다.
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">3.8 솔리드화</h3>
          <p>
            3D AI 출력물에는 겹친 모서리가 수만 개, 서로 뚫고 지나가는 면이 수천 쌍 있습니다. 구멍만
            메워서는 풀리지 않는 결함입니다. 솔리드화는 표면을 고치지 않고 부피를 다시 정합니다.
          </p>
          <p>
            먼저 껍질마다 바깥을 보게 감는 방향을 맞추고, 정점 셋이 같은 면을 방향의 합으로 묶습니다.
            반대 방향 짝은 합이 0이라 부피가 없습니다. 이 면은 가중치 0으로 남깁니다. 격자점마다
            일반화 와인딩 넘버 w를 재고 f = |w| − 0.5를 둡니다 [13]. 먼 삼각형 묶음은 BVH 노드의 면적
            벡터 합(쌍극자)으로 근사합니다 [14]. 구멍은 부드럽게 메워지고, 겹친 덩어리는 합쳐지며,
            양면 시트는 상쇄됩니다.
          </p>
          <p>
            다음으로 표면의 양쪽을 한 칸씩 떨어져 봅니다. 둘 다 바깥이면 두께가 없는 지느러미이거나
            격자 한 칸보다 얇은 판입니다. 이런 면에서 0.9칸 떨어진 곳이 0이 되는 거리장을 f에 더해 최소
            두께를 줍니다. 바깥과 이어지지 않은 속 빈 공간은 채웁니다. 연결은 마칭에 쓰는 사면체
            분할의 에지(14방향)로 판단해 결과와 정확히 맞춥니다.
          </p>
          <p>
            마지막으로 Kuhn 6-사면체 분할 위에서 f의 0-등위면을 뽑습니다. 격자점 값이 0이 아닌
            조각별 선형 함수의 등위면이라 닫혀 있고, 모든 모서리에 면이 정확히 둘이며, 각 조각이 제
            사면체 안에 있어 스스로 교차하지 않습니다. 표면 근처 격자점은 부호만 와인딩 넘버에서
            가져오고 크기는 원본까지 거리로 바꿔, 위상은 그대로 두고 표면 위치만 원본에 붙입니다.
            격자점 계산은 서로 독립이라 z층 묶음으로 나눠 여러 스레드에서 돌립니다. 교차점은 에지 양 끝 1%를 넘지 않게 두어
            바늘 같은 삼각형을 막고, 부피 0.1% 미만의 떠 있는 조각은 버립니다. 격자는 가장 긴 축을
            256칸으로 나누되 격자점 300만 개를 넘지 않게 하고, 입력 에지 중앙값의 1/4보다 잘게
            나누지 않습니다.
          </p>
          <p>
            대가도 분명합니다. 원래 삼각형과 UV·텍스처는 남지 않고, 삼각형 수는 입력의 2~4배가 됩니다.
            칸 크기보다 작은 틈은 붙고 날카로운 모서리는 둥글어집니다. 그래서 자동 선택은 겹친
            모서리나 관통이 없는 입력에서는 구멍 메우기를 먼저 해 보고, 결과가 깨끗하지 않을 때만
            솔리드화와 점수를 비교합니다.
          </p>
        </Section>

        <Section number="4" title="실험">
          <h3 className="text-[15px] font-medium text-ink-100 mb-3">4.1 단계를 하나씩 뺀 실험</h3>
          <p>
            같은 모델을 올린 그대로, 용접한 뒤 구멍을 전부 부채꼴로 메운 것, 구멍 메우기, 솔리드화,
            자동 선택으로 잽니다. 부채꼴에서 멈추고 구멍 메우기에서만 만점이면 분류와 방향 맞추기가
            필요한 구멍입니다. 구멍 메우기도 멈추는 모델은 솔리드화가 필요한 결함입니다.
          </p>

          <div className="my-6 rounded-lg border border-ink-800 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60">
                  <th className="text-left font-normal text-ink-400 px-3 py-2.5">모델</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.raw}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.naiveFan}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.patch}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.solid}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">{VARIANT_LABEL.meshcap}</th>
                  <th className="text-right font-normal text-ink-400 px-3 py-2.5">모양 유지</th>
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
                      {model.variants.naiveFan.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {model.variants.patch.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {model.variants.solid.score}
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono text-ink-100">
                      {model.variants.meshcap.score}
                      <div className="text-[10.5px] text-ink-500">
                        {model.variants.meshcap.engine === 'solid' ? VARIANT_LABEL.solid : VARIANT_LABEL.patch}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-right font-mono">
                      {(model.variants.meshcap.shapeKept * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            {bust && (
              <>
                {bust.label}은 올린 그대로 테두리 {bust.variants.raw.holes}개로 잡히고, 부채꼴은{' '}
                {bust.variants.naiveFan.score}점·비다양체 에지 {bust.variants.naiveFan.nonManifoldEdges}개로
                끝납니다. 구멍 메우기는 분류기 기준 {filledHoles('syn-bust')}개를 메워{' '}
                {bust.variants.patch.score}점, 비다양체 0입니다.{' '}
              </>
            )}
            {worst && (
              <>
                {worst.label}처럼 결함을 겹쳐 두면 구멍 메우기는 {worst.variants.patch.score}점에
                머뭅니다. 밀폐는 되지만 비다양체 에지 {worst.variants.patch.nonManifoldEdges}개가
                남습니다. 자동 선택은 여기서 솔리드화를 골라 {worst.variants.meshcap.score}점이 되고,
                원래 표면의 {(worst.variants.meshcap.shapeKept * 100).toFixed(1)}%가 0.5% 안에 남습니다.
              </>
            )}
          </p>

          <h3 className="text-[15px] font-medium text-ink-100 mt-10 mb-3">4.2 3D AI 예제</h3>
          <p>
            도구 화면의 3D AI 예제 두 개(보기용으로 줄인 STL)를 같은 코어로 잰 값입니다. 점수는 올린
            그대로에서 보정 후로 적었습니다. 시간은 파이프라인 전체를 14코어 노트북의 Node 24로 잰
            값이고, 솔리드화는 와인딩 넘버 격자를 보조 스레드 8개로 나눠 계산했습니다. 스레드 수와
            상관없이 결과 메시는 비트 단위로 같습니다.
          </p>

          <div className="my-6 rounded-lg border border-ink-800 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-ink-800 bg-ink-900/60">
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5" />
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">3D AI A</th>
                  <th className="text-left font-normal text-ink-400 px-4 py-2.5">3D AI B</th>
                </tr>
              </thead>
              <tbody className="text-ink-300">
                {AI_EXAMPLE_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-ink-800/60 last:border-0">
                    <td className="px-4 py-2">{row.label}</td>
                    <td className="px-4 py-2 font-mono">{row.a}</td>
                    <td className="px-4 py-2 font-mono">{row.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p>
            두 예제 모두 올린 그대로는 구멍이 거의 없습니다. 대신 겹친 모서리와 서로 뚫고 지나가는
            면이 많습니다. 구멍 메우기는 반대 방향으로 두 번 든 면을 하나로 줄이면서 테두리를 새로
            만들고, 그 자리를 메우다 관통을 더 만들어 점수가 내려갑니다. 솔리드화는 겹친 모서리와
            관통을 모두 없애 100점이 되고, OrcaSlicer 2.4.2도 두 결과를 manifold, 한 덩어리로
            읽습니다. 다만 두께 없는 면에 두께를 주고 속에 묻힌 면을 지우므로 원래 모양 유지율은
            100%가 아닙니다. 3D AI A는 표면 넓이의 절반 가까이가 격자 한 칸보다 얇아, 그 부분이
            최소 두께를 받으면서 부피가 늘어납니다. 예전 판의 보정 전 점수는 중복 면을 지운 뒤의 상태를
            쟀고 관통 검사를 보정 후에만 해서, 같은 파일인데도 지금 기준보다 높거나 낮게 나왔습니다.
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
              고립된 여분 면은 지우지만, 본 시트에 묶인 이중 표면까지 자동으로 합치지는 않습니다.
            </Limitation>
            <Limitation>
              양 끝이 시트에 붙은 고립 1-면(짧은 루프가 아닌 변)은 세 번째 면을 올리면 비다양체가
              됩니다. 아래 시트가 보이면 띠로 잇고, 창처럼 아래가 비면 남겨 둡니다. 점수는 진단입니다.
            </Limitation>
            <Limitation>
              바닥 받침은 테두리를 수직으로 내리므로, 투영된 테두리가 스스로 겹치는 심하게 오목한
              개구부에서는 옆벽이 서로 교차할 수 있습니다.
            </Limitation>
            <Limitation>
              벽 두께는 따로 검사하지 않습니다. 솔리드화는 격자 한 칸보다 얇은 면에 1.8칸 두께를 주고,
              그보다 두꺼운 벽은 그대로 둡니다. 벽이 노즐 지름보다 얇은지는 슬라이서에 맡깁니다.
            </Limitation>
            <Limitation>
              솔리드화는 표면을 새로 뽑으므로 원래 삼각형·UV·텍스처가 남지 않고 삼각형 수가 늘어납니다.
              칸보다 작은 틈은 붙고 날카로운 모서리는 둥글어집니다. 원래 모양 유지율을 함께 보여
              주지만, 점수에는 넣지 않습니다.
            </Limitation>
          </ul>
          <p className="mt-6">
            생성형 메시가 출력에 실패하는 이유는 구멍만이 아닙니다. 이음매 정점, 뒤집힌 면, 비다양체
            지점이 구멍 탐지부터 속이고, 겹친 면과 관통은 구멍을 메워도 남습니다. MeshCap은 결함이
            구멍뿐인 입력은 원래 삼각형을 지킨 채 메우고, 그렇지 않은 입력은 부피를 다시 정해 닫힌
            표면을 새로 뽑습니다. 보정 전후는 같은 잣대로 재고, 점수가 오른 만큼 모양이 얼마나
            달라졌는지도 함께 보여 줍니다.
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
            <li>
              W. Zhao, S. Gao, and H. Lin, &ldquo;A robust hole-filling algorithm for triangular
              mesh,&rdquo; <em>The Visual Computer</em>, vol. 23, 2007.
            </li>
            <li>
              W. E. Lorensen and H. E. Cline, &ldquo;Marching cubes: A high resolution 3D surface
              construction algorithm,&rdquo; in <em>Proc. ACM SIGGRAPH</em>, 1987.
            </li>
            <li>
              T. Ju, &ldquo;Robust repair of polygonal models,&rdquo; in <em>Proc. ACM SIGGRAPH</em>,
              2004.
            </li>
            <li>
              A. Jacobson, L. Kavan, and O. Sorkine-Hornung, &ldquo;Robust Inside-Outside Segmentation
              using Generalized Winding Numbers,&rdquo; <em>ACM Trans. Graph.</em>, 2013.
            </li>
            <li>
              G. Barill, N. Dickson, R. Schmidt, D. I. W. Levin, and A. Jacobson, &ldquo;Fast Winding
              Numbers for Soups and Clouds,&rdquo; <em>ACM Trans. Graph.</em>, 2018.
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
              {['단일 삼각형', '부채꼴', '평면 투영', 'Liepa 세분', '전진 전면', '복셀 랩', '바닥 받침', '미세 붕괴'].map((name) => (
                <Badge key={name} tone="patch">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">09</span>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-patch mt-[7px]" />
            <div className="w-px flex-1 bg-ink-700 my-1" />
          </div>
          <div className="pb-4 flex-1">
            <div className="text-[13.5px] text-ink-100">남은 찢김</div>
            <div className="text-[11.5px] text-ink-400 mt-0.5">
              겹친 여분을 떼고, 시트에 가까운 1-면은 새 정점만으로 얇은 띠를 붙임
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {['여분 삭제', '틈 띠'].map((name) => (
                <Badge key={name} tone="patch">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">10</span>
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col items-center shrink-0">
            <div className="w-2 h-2 rounded-full bg-patch mt-[7px]" />
            <div className="w-px flex-1 bg-ink-700 my-1" />
          </div>
          <div className="pb-4 flex-1">
            <div className="text-[13.5px] text-ink-100">솔리드화 (겹친 모서리·관통이 있을 때)</div>
            <div className="text-[11.5px] text-ink-400 mt-0.5">
              와인딩 넘버로 안팎을 다시 정하고 사면체 분할 위에서 닫힌 표면을 새로 뽑음
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {['와인딩 넘버', '얇은 면 두께', '속 빈 곳 채우기', '마칭 테트라', '작은 조각 정리'].map((name) => (
                <Badge key={name} tone="patch">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">11</span>
        </div>

        {[
          { label: '바깥 방향 정렬', detail: '껍질별 부호 있는 부피로 안팎 판정', n: '12' },
          { label: '검증 및 채점', detail: '올린 그대로와 결과를 같은 기준으로. 관통은 메시 전체', n: '13' },
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
