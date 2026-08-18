import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { MeshData } from '../core/types.ts';
import { computeBounds } from '../core/types.ts';
import type { UpAxis } from '../core/classify.ts';

export type ViewMode = 'before' | 'after';

const COLOR_SURFACE = 0x9aa4b2;
const COLOR_CAP = 0x22d3ee;
const COLOR_HOLE = 0xff4d4f;
const COLOR_HOLE_ACTIVE = 0xffd166;

const AXIS_INDEX: Record<UpAxis, number> = { x: 0, y: 1, z: 2 };

export interface ViewerMeshInput {
  before: MeshData;
  after: MeshData;
  /** after 메시에서 이 인덱스부터가 새로 만든 삼각형이다. */
  capTriangleStart: number;
  /** before 메시 기준의 구멍 테두리 정점 인덱스 목록. */
  loops: number[][];
  upAxis: UpAxis;
}

export class MeshViewer {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: PerspectiveCamera;
  private controls: OrbitControls;
  private content = new Group();

  private beforeMesh: Mesh | null = null;
  private afterMesh: Mesh | null = null;
  private holeLines: LineSegments2 | null = null;
  private grid: GridHelper | null = null;

  private surfaceMaterial: MeshStandardMaterial;
  private capMaterial: MeshStandardMaterial;
  private holeMaterial: LineMaterial;

  private mode: ViewMode = 'before';
  private radius = 1;
  private disposed = false;

  private flight: { from: Vector3; to: Vector3; targetFrom: Vector3; targetTo: Vector3; t: number } | null =
    null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(new Color(0x0d0f13), 1);

    this.scene = new Scene();
    this.scene.add(this.content);

    this.camera = new PerspectiveCamera(42, 1, 0.01, 1000);
    this.camera.position.set(2.5, 2, 3.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.rotateSpeed = 0.85;

    this.scene.add(new HemisphereLight(0xdfe7f5, 0x141920, 1.1));
    this.scene.add(new AmbientLight(0xffffff, 0.25));

    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const fill = new DirectionalLight(0x9fc4ff, 0.6);
    fill.position.set(-4, 1, -3);
    this.scene.add(fill);

    const rim = new DirectionalLight(0xffd9a0, 0.5);
    rim.position.set(0, -3, -4);
    this.scene.add(rim);

    // 평면 셰이딩은 표면을 예쁘게 만들려는 게 아니라 면 구성을 그대로 드러내기 위한 선택이다.
    this.surfaceMaterial = new MeshStandardMaterial({
      color: COLOR_SURFACE,
      roughness: 0.62,
      metalness: 0.06,
      flatShading: true,
    });
    this.capMaterial = new MeshStandardMaterial({
      color: COLOR_CAP,
      roughness: 0.42,
      metalness: 0.1,
      emissive: new Color(0x0b3b45),
      flatShading: true,
    });
    // WebGL의 기본 선은 굵기를 1픽셀 넘게 줄 수 없어 큰 모델에서 테두리가 거의 보이지 않는다.
    // 구멍을 찾는 것이 이 도구의 핵심이므로 화면 공간 굵기를 지원하는 재질을 쓴다.
    // depthTest를 끈 것은 모델 뒤에 숨은 구멍도 찾을 수 있어야 하기 때문이다.
    this.holeMaterial = new LineMaterial({
      color: COLOR_HOLE,
      linewidth: 2.4,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
    });

    this.animate();
  }

  setMesh(input: ViewerMeshInput): void {
    this.clearContent();

    const bounds = computeBounds(input.before.positions);
    this.radius = Math.max(bounds.diagonal / 2, 1e-4);

    const up = new Vector3();
    up.setComponent(AXIS_INDEX[input.upAxis], 1);
    this.camera.up.copy(up);

    this.beforeMesh = new Mesh(toGeometry(input.before), this.surfaceMaterial);
    this.content.add(this.beforeMesh);

    const afterGeometry = toGeometry(input.after);
    const capStartIndex = input.capTriangleStart * 3;
    afterGeometry.clearGroups();
    afterGeometry.addGroup(0, capStartIndex, 0);
    afterGeometry.addGroup(capStartIndex, input.after.indices.length - capStartIndex, 1);

    this.afterMesh = new Mesh(afterGeometry, [this.surfaceMaterial, this.capMaterial]);
    this.content.add(this.afterMesh);

    this.holeLines = buildLoopLines(input.before, input.loops, this.holeMaterial);
    if (this.holeLines) this.content.add(this.holeLines);

    this.grid = buildBedGrid(bounds, AXIS_INDEX[input.upAxis]);
    this.scene.add(this.grid);

    this.setMode(this.mode);
    this.frameAll(bounds.center, bounds.diagonal);
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    if (this.beforeMesh) this.beforeMesh.visible = mode === 'before';
    if (this.afterMesh) this.afterMesh.visible = mode === 'after';
    // 보정 후에는 테두리가 사라졌음을 보여주기 위해 선을 감춘다.
    if (this.holeLines) this.holeLines.visible = mode === 'before';
  }

  setWireframe(enabled: boolean): void {
    this.surfaceMaterial.wireframe = enabled;
    this.capMaterial.wireframe = enabled;
  }

  setHolesVisible(visible: boolean): void {
    if (this.holeLines) this.holeLines.visible = visible && this.mode === 'before';
  }

  /** 특정 구멍이 화면 가운데 오도록 카메라를 이동시킨다. */
  focusPoint(point: [number, number, number], approach: [number, number, number], spread: number): void {
    const target = new Vector3(point[0], point[1], point[2]);
    const distance = Math.max(spread * 2.6, this.radius * 0.28);
    const direction = new Vector3(approach[0], approach[1], approach[2]);
    if (direction.lengthSq() < 1e-12) direction.set(0.6, 0.5, 0.8);
    direction.normalize();

    this.flight = {
      from: this.camera.position.clone(),
      to: target.clone().addScaledVector(direction, distance),
      targetFrom: this.controls.target.clone(),
      targetTo: target,
      t: 0,
    };
  }

  frameAll(center: [number, number, number] | Vector3, diagonal: number): void {
    const target = center instanceof Vector3 ? center.clone() : new Vector3(...center);
    const distance = (diagonal / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;

    this.camera.near = Math.max(diagonal / 1000, 1e-4);
    this.camera.far = diagonal * 20;
    this.camera.updateProjectionMatrix();

    this.flight = {
      from: this.camera.position.clone(),
      to: target.clone().add(new Vector3(0.62, 0.5, 0.88).normalize().multiplyScalar(distance)),
      targetFrom: this.controls.target.clone(),
      targetTo: target,
      t: 0,
    };
  }

  resize(): void {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    if (width === 0 || height === 0) return;

    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    // 화면 공간 굵기 계산에 필요하다. 갱신하지 않으면 창 크기를 바꿀 때 선이 뒤틀린다.
    this.holeMaterial.resolution = new Vector2(width, height);
  }

  dispose(): void {
    this.disposed = true;
    this.clearContent();
    this.controls.dispose();
    this.surfaceMaterial.dispose();
    this.capMaterial.dispose();
    this.holeMaterial.dispose();
    this.renderer.dispose();
  }

  private clearContent(): void {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      disposeObject(child as Mesh | LineSegments2);
    }
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid = null;
    }
    this.beforeMesh = null;
    this.afterMesh = null;
    this.holeLines = null;
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);

    if (this.flight) {
      this.flight.t = Math.min(1, this.flight.t + 0.07);
      const eased = easeOutCubic(this.flight.t);
      this.camera.position.lerpVectors(this.flight.from, this.flight.to, eased);
      this.controls.target.lerpVectors(this.flight.targetFrom, this.flight.targetTo, eased);
      if (this.flight.t >= 1) this.flight = null;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function toGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  // 평면 셰이딩은 도함수로 법선을 만들므로 normal 속성을 계산할 필요가 없다.
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  return geometry;
}

function buildLoopLines(
  mesh: MeshData,
  loops: number[][],
  material: LineMaterial,
): LineSegments2 | null {
  if (loops.length === 0) return null;

  const points: number[] = [];
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] * 3;
      const b = loop[(i + 1) % loop.length] * 3;
      points.push(
        mesh.positions[a],
        mesh.positions[a + 1],
        mesh.positions[a + 2],
        mesh.positions[b],
        mesh.positions[b + 1],
        mesh.positions[b + 2],
      );
    }
  }

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(points);

  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = 10;
  return lines;
}

/** 모델 바닥에 프린터 베드를 연상시키는 격자를 깐다. */
function buildBedGrid(bounds: ReturnType<typeof computeBounds>, upIndex: number): GridHelper {
  const span = Math.max(bounds.diagonal * 1.4, 1e-3);
  const grid = new GridHelper(span, 24, 0x2c333d, 0x1c2128);

  // GridHelper는 XZ 평면에 놓이므로 위 축에 맞춰 눕힌다.
  if (upIndex === 2) grid.rotation.x = Math.PI / 2;
  else if (upIndex === 0) grid.rotation.z = Math.PI / 2;

  const position: [number, number, number] = [bounds.center[0], bounds.center[1], bounds.center[2]];
  position[upIndex] = bounds.min[upIndex];
  grid.position.set(...position);

  const material = grid.material as LineBasicMaterial;
  material.transparent = true;
  material.opacity = 0.5;

  return grid;
}

function disposeObject(object: Mesh | LineSegments2): void {
  object.geometry?.dispose();
}

export { COLOR_CAP, COLOR_HOLE, COLOR_HOLE_ACTIVE, COLOR_SURFACE };
