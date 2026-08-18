import { useEffect, useRef } from 'react';
import { MeshViewer, type ViewMode, type ViewerMeshInput } from '../viewer/MeshViewer.ts';

export interface FocusRequest {
  point: [number, number, number];
  approach: [number, number, number];
  spread: number;
  /** 같은 구멍을 다시 눌러도 카메라가 움직이도록 매번 바뀌는 값. */
  nonce: number;
}

export function Viewer({
  input,
  mode,
  wireframe,
  focus,
  resetNonce,
}: {
  input: ViewerMeshInput | null;
  mode: ViewMode;
  wireframe: boolean;
  focus: FocusRequest | null;
  resetNonce: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<MeshViewer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const viewer = new MeshViewer(canvas);
    viewerRef.current = viewer;
    viewer.resize();

    const observer = new ResizeObserver(() => viewer.resize());
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (input) viewerRef.current?.setMesh(input);
  }, [input]);

  useEffect(() => {
    viewerRef.current?.setMode(mode);
  }, [mode, input]);

  useEffect(() => {
    viewerRef.current?.setWireframe(wireframe);
  }, [wireframe]);

  useEffect(() => {
    if (focus) viewerRef.current?.focusPoint(focus.point, focus.approach, focus.spread);
  }, [focus]);

  useEffect(() => {
    if (resetNonce > 0 && input) {
      const bounds = boundsOf(input);
      viewerRef.current?.frameAll(bounds.center, bounds.diagonal);
    }
  }, [resetNonce, input]);

  return <canvas ref={canvasRef} className="block w-full h-full outline-none" />;
}

function boundsOf(input: ViewerMeshInput) {
  const positions = input.before.positions;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }

  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2] as [number, number, number],
    diagonal: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ),
  };
}
