import { REPO_URL } from '../App.tsx';

const TEAM = [
  {
    name: '조원준',
    studentId: '202413011',
    role: '총괄 · 3D 생성 파이프라인',
  },
  {
    name: '박정훈',
    studentId: '202413032',
    role: '구멍 메우기 · 메시 정리',
  },
  {
    name: '배윤서',
    studentId: '202413143',
    role: '출력 테스트 · 기록',
  },
];

const AI_TOOLS = [
  { name: '3D AI', usage: '비교용 3D 모델 생성' },
  { name: 'ChatGPT · Claude', usage: '설계 초안, 알고리즘 점검, 실험 기록' },
  { name: 'Stable Diffusion · Midjourney', usage: '생성에 넣을 콘셉트 이미지' },
  { name: 'RunyourAI · Gcube', usage: 'GPU에서 생성 돌려 보기' },
];

const STACK = [
  { name: 'TypeScript', usage: '알고리즘 코어 전체' },
  { name: 'three.js', usage: '파일 로드와 3D 뷰어' },
  { name: 'earcut', usage: '평면을 삼각형으로 나누기' },
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
            청강문화산업대학교 게임콘텐츠스쿨에서 셋이 만든 도구입니다. 생성형 3D 캐릭터를
            출력하면 거의 매번 구멍이 남아 있습니다. 그 구멍을 손으로 고치는 시간을 줄이려고
            만들었습니다.
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
            게임콘텐츠스쿨 셋이서 생성, 메시 정리, 출력 확인을 나눴습니다.
          </p>
        </Section>

        <Section title="사용한 AI 도구">
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
            콘셉트와 초안 정리에 AI를 썼습니다. 메시를 읽고 구멍을 메우는 코드는 직접 짰고,
            테스트로 확인합니다. 커밋 로그에 그 과정이 남아 있습니다.
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

        <Section title="파일은 어디에 남나">
          <p className="text-[13.5px] leading-relaxed text-ink-300">
            원본 파일은 브라우저 밖으로 안 나갑니다. 여는 것, 텍스처를 버리고 좌표만 남기는 것
            모두 여기서 합니다. 기본값에선 계산도 마찬가지입니다.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-300">
            삼각형이 50만을 넘으면 팀 서버로 넘길 수 있습니다. 가는 건 좌표와 인덱스뿐입니다.
            서버는 결과만 돌려주고 저장하지 않습니다. 화면에서 브라우저로 고정할 수 있고, 어디서
            돌렸는지는 매번 보여 줍니다.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-ink-300">
            분석 스크립트나 쿠키는 없습니다. 서버는 팀 장비고 Tailscale 안에만 열려 있습니다.
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
            {REPO_URL.replace('https://github.com/', '')}
          </a>
          <p className="mt-3 text-[12.5px] text-ink-400">MIT 라이선스입니다.</p>
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
