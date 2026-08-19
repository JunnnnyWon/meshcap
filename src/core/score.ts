import type { ValidationReport } from './validate.ts';

export interface ScoreItem {
  id: string;
  label: string;
  /** 이 항목의 만점. */
  max: number;
  earned: number;
  /** 사용자에게 보여줄 근거 한 줄. */
  detail: string;
}

export interface PrintabilityScore {
  total: number;
  items: ScoreItem[];
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  /** 한 줄 총평. */
  verdict: string;
}

/**
 * 3D 프린팅 적합성을 100점으로 환산한다.
 *
 * 배점은 슬라이서가 실제로 실패하는 순서를 따랐다. 경계 에지가 남으면 아예
 * 슬라이싱이 안 되므로 가장 무겁고, non-manifold는 안팎 판정을 망가뜨리며,
 * 법선 방향은 살은 채우되 뒤집힌 결과를 만든다. 뒤로 갈수록 출력은 되지만
 * 품질이 떨어지는 항목이다.
 */
export function scorePrintability(report: ValidationReport): PrintabilityScore {
  const items: ScoreItem[] = [];

  items.push(
    gradeItem({
      id: 'watertight',
      label: '완전 밀폐',
      max: 35,
      ok: report.boundaryEdgeCount === 0,
      // 전체 에지의 5%가 경계면 0점이 되도록 기울기를 잡았다.
      ratio: report.boundaryEdgeCount / Math.max(1, report.edgeCount * 0.05),
      okDetail: '열린 경계가 없습니다',
      failDetail: `경계 에지 ${fmt(report.boundaryEdgeCount)}개, 구멍 ${fmt(report.boundaryLoopCount)}개`,
    }),
  );

  const nonManifold = report.nonManifoldEdgeCount + report.nonManifoldVertexCount;
  items.push(
    gradeItem({
      id: 'manifold',
      label: '다양체 위상',
      max: 25,
      ok: nonManifold === 0,
      ratio: nonManifold / Math.max(1, report.edgeCount * 0.01),
      okDetail: '세 면 이상 만나는 에지가 없습니다',
      failDetail: `비다양체 에지 ${fmt(report.nonManifoldEdgeCount)}개, 정점 ${fmt(report.nonManifoldVertexCount)}개`,
    }),
  );

  items.push(
    gradeItem({
      id: 'normals',
      label: '법선 방향',
      max: 15,
      ok: report.inconsistentEdgeCount === 0,
      ratio: report.inconsistentEdgeCount / Math.max(1, report.edgeCount * 0.02),
      okDetail: '모든 면이 같은 방향으로 정렬되어 있습니다',
      failDetail: `방향이 어긋난 에지 ${fmt(report.inconsistentEdgeCount)}개`,
    }),
  );

  const shells = report.connectedComponents;
  items.push({
    id: 'shells',
    label: '단일 껍질',
    max: 10,
    earned: shells <= 1 ? 10 : Math.max(0, 12 - shells * 2),
    detail:
      shells <= 1
        ? '떠 있는 조각이 없습니다'
        : `분리된 덩어리 ${fmt(shells)}개. 의도한 파츠 분할이 아니라면 부유 조각입니다`,
  });

  items.push({
    id: 'degenerate',
    label: '삼각형 품질',
    max: 10,
    // 전체의 0.1%가 퇴화면 0점이 된다.
    earned:
      report.degenerateTriangles === 0
        ? 10
        : Math.min(9, Math.max(0, Math.round(10 * (1 - report.degenerateRatio / 0.001)))),
    detail:
      report.degenerateTriangles === 0
        ? '면적이 0에 가까운 삼각형이 없습니다'
        : `퇴화 삼각형 ${fmt(report.degenerateTriangles)}개 (${(report.degenerateRatio * 100).toFixed(3)}%)`,
  });

  items.push({
    id: 'intersection',
    label: '뚜껑 관통',
    max: 5,
    earned: !report.selfIntersectionChecked
      ? 5
      : Math.max(0, 5 - report.capSelfIntersections),
    detail: !report.selfIntersectionChecked
      ? '메시가 커서 교차 검사를 생략했습니다'
      : report.capSelfIntersections === 0
        ? '새로 만든 면이 기존 표면을 뚫지 않았습니다'
        : `기존 표면과 교차하는 뚜껑 삼각형 ${fmt(report.capSelfIntersections)}개`,
  });

  const total = items.reduce((sum, item) => sum + item.earned, 0);

  return {
    total,
    items,
    grade: toGrade(total),
    verdict: toVerdict(total, report),
  };
}

function gradeItem(input: {
  id: string;
  label: string;
  max: number;
  ok: boolean;
  ratio: number;
  okDetail: string;
  failDetail: string;
}): ScoreItem {
  // 결함이 하나라도 있으면 만점을 주지 않는다. 비율이 미미해 반올림하면 만점이
  // 나오는데, 그러면 "만점인데 결함 설명이 붙은" 모순된 항목이 화면에 뜬다.
  const earned = input.ok
    ? input.max
    : Math.min(input.max - 1, Math.max(0, Math.round(input.max * (1 - input.ratio))));
  return {
    id: input.id,
    label: input.label,
    max: input.max,
    earned,
    detail: input.ok ? input.okDetail : input.failDetail,
  };
}

function toGrade(total: number): PrintabilityScore['grade'] {
  if (total >= 95) return 'A';
  if (total >= 85) return 'B';
  if (total >= 70) return 'C';
  if (total >= 50) return 'D';
  return 'F';
}

function toVerdict(total: number, report: ValidationReport): string {
  if (!report.watertight) {
    return '경계가 열려 있어 슬라이서가 속을 못 채웁니다. 보정이 필요합니다.';
  }
  if (total >= 95) return '슬라이서에 그대로 넣어도 됩니다.';
  if (total >= 85) return '출력은 되는데 자잘한 결함이 남습니다.';
  if (total >= 70) return '출력은 되지만 결과물에 티가 날 수 있습니다.';
  return '슬라이서가 모양을 잘못 잡을 가능성이 큽니다.';
}

function fmt(n: number): string {
  return n.toLocaleString('ko-KR');
}
