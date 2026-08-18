import type { ReactNode } from 'react';
import rawResults from '../bench/results.json';
import type { BenchmarkFile } from '../bench/schema.ts';
import { Badge } from '../components/ui.tsx';

const data = rawResults as BenchmarkFile;
const bust = data.models.find((m) => m.id === 'syn-bust');
const splitOnly = data.models.find((m) => m.id === 'syn-split-only');

export function MethodPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-6 py-12">
        <header className="mb-12">
          <div className="label-caps mb-3">알고리즘</div>
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink-100">
            구멍을 찾는 것보다, 찾기 전에 무엇을 하느냐가 결과를 가릅니다
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-300">
            메시에서 구멍을 찾는 일 자체는 어렵지 않습니다. 면 하나만 접한 에지를 모아 이으면
            됩니다. 문제는 생성형 3D 출력물에서 그 정의가 곧바로 무너진다는 데 있습니다. 아래는
            MeshCap이 순서를 이렇게 정한 이유입니다.
          </p>
        </header>

        <Pipeline />

        <Section number="01" title="정점 용접이 가장 먼저인 이유">
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
        </Section>

        <Section number="02" title="법선 정렬이 구멍 탐지보다 먼저인 이유">
          <p>
            이 순서는 처음에 반대로 두었다가 바로잡은 부분입니다. 감는 방향이 뒤집힌 면이 구멍
            테두리에 닿아 있으면, 그 지점에서 경계 에지의 진행 방향이 반대로 뒤집힙니다. 테두리를
            따라가던 탐색이 거기서 갈 곳을 잃고, 하나였던 구멍이 여러 개의 열린 사슬로 쪼개집니다.
            열린 사슬은 어디까지가 구멍인지 알 수 없어 안전하게 메울 수 없습니다.
          </p>
          {bust && (
            <Callout>
              대조군 <strong>{bust.label}</strong>에 뒤집힌 면을 섞어 두었습니다. 정렬을 나중에 하면
              테두리가 조각나 점수가 <Mono>{bust.variants.naiveFan.score}점</Mono>에서 멈추지만,
              정렬을 먼저 하면 같은 모델이 <Mono>{bust.variants.meshcap.score}점</Mono>으로 완전히
              밀폐됩니다.
            </Callout>
          )}
          <p>
            다만 방향 통일과 <em className="text-ink-200 not-italic">바깥 방향 맞추기</em>는 다른
            일입니다. 이웃 면끼리 방향을 맞추는 전파는 열린 메시에서도 되지만, 껍질이 안팎 중 어디를
            향하는지는 부호 있는 부피로 판정하므로 닫힌 뒤에야 의미가 있습니다. 그래서 전파는 앞에,
            바깥 방향 판정은 구멍을 다 메운 뒤에 둡니다.
          </p>
        </Section>

        <Section number="03" title="구멍을 분류하는 기준">
          <p>
            모든 구멍을 같은 방법으로 메우면 반드시 어딘가가 망가집니다. 피규어 바닥의 큰 개구부를
            부채꼴로 메우면 가운데가 원뿔처럼 솟아 서포트가 붙고, 반대로 머리카락 사이의 작은 구멍을
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
                  strategy="건너뜀"
                  reason="어디까지가 구멍인지 확정할 수 없음"
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
        </Section>

        <Section number="04" title="네 가지 메우기 방식">
          <div className="space-y-5">
            <Strategy name="부채꼴" tone="neutral">
              테두리 중심에 정점 하나를 두고 방사형으로 잇습니다. 가장 빠르지만 구멍이 커지면 중심점이
              표면에서 멀어져 원뿔처럼 솟습니다. 그래서 작은 구멍에만 씁니다.
            </Strategy>
            <Strategy name="평면 투영" tone="patch">
              테두리의 최적 평면을 Newell 방법으로 구하고, 그 평면에 투영해 earcut으로 삼각화합니다.
              새 정점을 만들지 않으므로 표면 밖으로 솟지 않고, 오목한 다각형도 올바르게 채웁니다.
            </Strategy>
            <Strategy name="Liepa DP" tone="amber">
              테두리를 채우는 모든 삼각화 중 <em className="not-italic text-ink-200">(이웃 면과 이루는
              최대 이면각, 총 넓이)</em>를 사전식으로 최소화하는 것을 동적계획법으로 찾습니다. 넓이만
              최소화하면 얇고 길쭉한 삼각형이 나오지만, 이면각을 앞세우면 주변 곡률을 이어받습니다.
              평면에서 크게 벗어난 구멍에 씁니다.
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
            병적인 입력에서 품질을 조금 포기하더라도 구멍이 남는 것보다는 낫기 때문입니다.
          </p>
        </Section>

        <Section number="05" title="출력 적합성 채점">
          <p>
            배점은 슬라이서가 실제로 실패하는 순서를 따랐습니다. 경계 에지가 남으면 아예 슬라이싱이
            되지 않으므로 가장 무겁고, 뒤로 갈수록 출력은 되지만 품질이 떨어지는 항목입니다.
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

        <Section number="06" title="알려진 한계">
          <ul className="space-y-2.5 list-none pl-0">
            <Limitation>
              테두리가 한 정점에서 여러 갈래로 갈라지는 나비넥타이 형태에서는 어느 갈래를 먼저 따라가느냐에
              따라 구멍이 나뉘는 모양이 달라집니다. 전체를 빠짐없이 덮는다는 점은 유지되지만 분할 결과가
              유일하지는 않습니다.
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
              이상에서는 브라우저가 눈에 띄게 멈추기 때문입니다.
            </Limitation>
          </ul>
        </Section>
      </div>
    </div>
  );
}

function Pipeline() {
  const stages = [
    { label: '파일 로드', detail: 'GLB · OBJ · STL · PLY를 하나의 삼각형 목록으로' },
    { label: '정점 용접', detail: '공간 해시로 좌표가 같은 정점 병합' },
    { label: '법선 방향 통일', detail: '이웃 면끼리 감는 방향 전파' },
    { label: '위상 분석', detail: 'half-edge로 경계·비다양체·연결 요소 집계' },
    { label: '테두리 추적', detail: '경계 half-edge를 이어 구멍 루프 복원' },
    { label: '구멍 분류', detail: '둘레 · 평면성 · 방향으로 전략 배정' },
  ];

  return (
    <div className="mb-14 rounded-xl border border-ink-800 bg-ink-900/40 p-6">
      <div className="label-caps mb-5">처리 순서</div>

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
            <div className="flex flex-wrap gap-1.5 mt-2">
              {['단일 삼각형', '부채꼴', '평면 투영', 'Liepa DP', '바닥 받침'].map((name) => (
                <Badge key={name} tone="patch">
                  {name}
                </Badge>
              ))}
            </div>
          </div>
          <span className="ml-auto font-mono text-[10px] text-ink-700 mt-1">07</span>
        </div>

        {[
          { label: '바깥 방향 정렬', detail: '껍질별 부호 있는 부피로 안팎 판정', n: '08' },
          { label: '검증 및 채점', detail: '밀폐 · 다양체 · 관통 검사 후 100점 환산', n: '09' },
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
