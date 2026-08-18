import { REPO_URL } from '../App.tsx';

const TEAM = [
  {
    name: '조원준',
    studentId: '202413011',
    role: '프로젝트 총괄 · 3D 생성 파이프라인 설계',
  },
  {
    name: '박정훈',
    studentId: '202413032',
    role: 'Cap 보정 및 메시 최적화 연구',
  },
  {
    name: '배윤서',
    studentId: '202413143',
    role: '3D 프린팅 테스트 및 결과 기록',
  },
];

const AI_TOOLS = [
  { name: 'Tripo3D', usage: '비교 대상 3D 모델 생성' },
  { name: 'Meshy AI', usage: '비교 대상 3D 모델 생성' },
  { name: 'ChatGPT · Claude', usage: '연구 설계, 알고리즘 검토, 실험 기록 정리' },
  { name: 'Stable Diffusion · Midjourney', usage: '생성 입력용 콘셉트 이미지 제작' },
  { name: 'RunyourAI · Gcube', usage: 'GPU 환경에서의 생성 워크플로 실험' },
];

const STACK = [
  { name: 'TypeScript', usage: '알고리즘 코어 전체' },
  { name: 'three.js', usage: '파일 로드와 3D 뷰어' },
  { name: 'earcut', usage: '평면 다각형 삼각화' },
  { name: 'React · Vite · Tailwind', usage: '인터페이스' },
  { name: 'Vitest', usage: '코어 알고리즘 단위 테스트' },
];

export function AboutPage() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[820px] px-6 py-12">
        <header className="mb-12">
          <div className="label-caps mb-3">프로젝트</div>
          <h1 className="text-[30px] leading-tight font-semibold tracking-[-0.02em] text-ink-100">
            3D AI 메시 최적화 및 피규어 제작
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-ink-300">
            청강문화산업대학교 최초의 AI 연구 동아리에서 진행한 연구입니다. 생성형 3D 서비스로 만든
            캐릭터를 실제로 출력해 보면 거의 언제나 메시 결함에 막힙니다. 그 결함을 손으로 고치는 데
            들어가는 시간을 없애는 것이 이 도구의 목표입니다.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-ink-300">
            2026 청강 AI 크리에이티브 부스트 공모전 출품작.
          </p>
        </header>

        <Section title="팀 구성">
          <div className="space-y-2">
            {TEAM.map((member) => (
              <div
                key={member.studentId}
                className="flex items-baseline gap-3 flex-wrap rounded-lg border border-ink-800 bg-ink-900/40 px-4 py-3"
              >
                <span className="text-[14px] text-ink-100">{member.name}</span>
                <span className="font-mono text-[11px] text-ink-600">{member.studentId}</span>
                <span className="text-[12.5px] text-ink-400 ml-auto">{member.role}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-400">
            게임콘텐츠스쿨 소속 3인이 3D 생성, 메시 최적화, 출력 검증을 나눠 맡았습니다.
          </p>
        </Section>

        <Section title="AI 도구 활용 내역">
          <div className="rounded-lg border border-ink-800 overflow-hidden">
            {AI_TOOLS.map((tool, index) => (
              <div
                key={tool.name}
                className={`flex items-baseline gap-4 px-4 py-2.5 ${
                  index > 0 ? 'border-t border-ink-800/60' : ''
                }`}
              >
                <span className="text-[13px] text-ink-100 w-[190px] shrink-0">{tool.name}</span>
                <span className="text-[12.5px] text-ink-400">{tool.usage}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-400">
            AI는 콘셉트 생성과 연구 보조에 사용했습니다. 이 웹사이트의 메시 처리 알고리즘은 생성형
            AI의 출력물을 그대로 옮긴 것이 아니라, 위상 자료구조부터 삼각화까지 직접 설계하고 단위
            테스트로 검증한 결과입니다. 저장소의 커밋 이력과 테스트 코드에서 과정을 확인할 수 있습니다.
          </p>
        </Section>

        <Section title="구현 스택">
          <div className="rounded-lg border border-ink-800 overflow-hidden">
            {STACK.map((item, index) => (
              <div
                key={item.name}
                className={`flex items-baseline gap-4 px-4 py-2.5 ${
                  index > 0 ? 'border-t border-ink-800/60' : ''
                }`}
              >
                <span className="font-mono text-[12.5px] text-ink-100 w-[190px] shrink-0">
                  {item.name}
                </span>
                <span className="text-[12.5px] text-ink-400">{item.usage}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="개인정보 처리">
          <p className="text-[13.5px] leading-relaxed text-ink-300">
            넣은 모델 파일은 브라우저 메모리에서만 처리되며 어디로도 전송되지 않습니다. 분석
            스크립트나 쿠키도 사용하지 않습니다. 서버는 정적 파일을 내려주는 nginx 컨테이너
            하나뿐이고, 팀이 직접 운영하는 장비에서 Tailscale 테일넷 안에만 열려 있습니다.
          </p>
        </Section>

        <Section title="저장소">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-ink-700 px-4 py-2.5 text-[13px] text-ink-200 hover:border-ink-600 hover:text-ink-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
            JunnnnyWon/meshcap
          </a>
          <p className="mt-3 text-[12.5px] text-ink-400">MIT 라이선스로 공개합니다.</p>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-11">
      <h2 className="text-[15px] font-medium text-ink-100 mb-4 pb-2.5 border-b border-ink-800">
        {title}
      </h2>
      {children}
    </section>
  );
}
