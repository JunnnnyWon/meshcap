import { useEffect, useRef } from 'react';
import { Euler, PerspectiveCamera, Quaternion, Scene, Vector3 } from 'three';
import { CSS3DObject, CSS3DRenderer } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import type { GalleryItem } from './catalog.ts';

type Props = {
  items: GalleryItem[];
  onOpen: (id: string) => void;
  enabled?: boolean;
};

const CARD = 88;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PACK = 2.9;
const AXIS_Y = new Vector3(0, 1, 0);
const FRONT = new Vector3(0, 0, 1);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function easeOut(t: number) {
  return 1 - (1 - t) ** 3;
}

function fibonacciPoint(index: number, count: number, radius: number, target: Vector3) {
  const y = count <= 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * index;
  target.set(Math.cos(theta) * ring * radius, y * radius, Math.sin(theta) * ring * radius);
}

export function GlobeWall({ items, onOpen, enabled = true }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const onOpenRef = useRef(onOpen);
  const enabledRef = useRef(enabled);
  onOpenRef.current = onOpen;
  enabledRef.current = enabled;

  const itemKey = items.map((item) => item.id).join('|');

  useEffect(() => {
    const hud = hudRef.current;
    const root = hostRef.current;
    if (!root) return;
    const el: HTMLDivElement = root;

    const scene = new Scene();
    const camera = new PerspectiveCamera(40, 1, 1, 20000);
    const renderer = new CSS3DRenderer();
    renderer.domElement.style.background = 'transparent';
    el.appendChild(renderer.domElement);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const objects: CSS3DObject[] = [];
    const world = new Vector3();
    const camDir = new Vector3();
    const localDir = new Vector3();
    const look = new Vector3();
    const axis = new Vector3();
    const dragQ = new Quaternion();
    const spinQ = new Quaternion();
    const fromQ = new Quaternion();
    const toQ = new Quaternion();
    const velAxis = new Vector3(0, 1, 0);

    const coreEl = document.createElement('div');
    coreEl.className = 'globe-core-disc';
    coreEl.setAttribute('aria-hidden', 'true');
    const coreObj = new CSS3DObject(coreEl);
    scene.add(coreObj);

    let radius = 200;
    let distance = 520;
    let fitted = false;
    let velSpeed = 0;
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downAt = 0;
    let lastT = performance.now();
    let idleAt = performance.now();
    let frontId: string | null = null;
    let focus: { t: number } | null = null;

    scene.quaternion.setFromEuler(new Euler(-0.16, 0.35, 0, 'YXZ'));

    function thumbOf(item: GalleryItem): string {
      return item.kind === 'video' ? (item.poster ?? item.src) : item.src;
    }

    function makeCard(item: GalleryItem): HTMLButtonElement {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `globe-card${item.kind === 'video' ? ' is-video' : ''}`;
      btn.dataset.id = item.id;
      btn.setAttribute('aria-label', item.caption);

      const img = document.createElement('img');
      img.src = thumbOf(item);
      img.alt = '';
      img.draggable = false;
      btn.appendChild(img);

      if (item.kind === 'video') {
        const mark = document.createElement('span');
        mark.className = 'globe-card-play';
        mark.setAttribute('aria-hidden', 'true');
        mark.innerHTML =
          '<svg width="8" height="8" viewBox="0 0 8 8" fill="white"><path d="M1.2.8v6.4L7.2 4z"/></svg>';
        btn.appendChild(mark);
      }

      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!enabledRef.current) return;
        if (item.id === frontId) onOpenRef.current(item.id);
        else focusId(item.id);
      });

      return btn;
    }

    function layout() {
      const n = objects.length;
      radius = CARD * Math.sqrt(Math.max(n, 8) / (PACK * Math.PI));
      for (let i = 0; i < n; i++) {
        fibonacciPoint(i, n, radius, objects[i].position);
      }
      const diam = `${Math.round(radius * 2 * 0.96)}px`;
      coreEl.style.width = diam;
      coreEl.style.height = diam;
    }

    function fill() {
      for (const obj of objects) scene.remove(obj);
      objects.length = 0;
      for (const item of items) {
        const obj = new CSS3DObject(makeCard(item));
        scene.add(obj);
        objects.push(obj);
      }
      layout();
    }

    function tumble(dx: number, dy: number) {
      const dist = Math.hypot(dx, dy);
      if (dist < 0.01) return;
      axis.set(dy, dx, 0).normalize();
      const angle = dist * 0.0055;
      dragQ.setFromAxisAngle(axis, angle);
      scene.quaternion.premultiply(dragQ);
      velAxis.copy(axis);
      velSpeed = angle;
    }

    function resize() {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w < 2 || h < 2) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      layout();
      if (!fitted) {
        distance = radius * 3.35;
        fitted = true;
      } else {
        distance = clamp(distance, radius * 2.05, radius * 5.2);
      }
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
    }

    function applyView() {
      camDir.copy(camera.position).normalize();
      look.copy(camera.position);
      coreObj.lookAt(look);

      let best = -Infinity;
      let bestObj: CSS3DObject | null = null;

      for (const obj of objects) {
        obj.lookAt(look);
        obj.getWorldPosition(world);
        const facing = world.normalize().dot(camDir);
        const k = clamp((1 - facing) * 0.5, 0, 1);
        const card = obj.element as HTMLElement;
        card.style.opacity = (1 - k * 0.82).toFixed(3);
        card.style.filter = reduceMotion ? 'none' : `blur(${(k * k * 5).toFixed(2)}px)`;
        obj.scale.setScalar(1 - k * 0.16);
        card.style.pointerEvents = k < 0.38 ? 'auto' : 'none';
        card.classList.remove('is-front');
        if (facing > best) {
          best = facing;
          bestObj = obj;
        }
      }

      if (bestObj) {
        bestObj.element.classList.add('is-front');
        const id = (bestObj.element as HTMLElement).dataset.id ?? null;
        frontId = id;
        if (hud) {
          const item = items.find((entry) => entry.id === id);
          hud.textContent = item?.caption ?? '';
        }
      } else if (hud) {
        hud.textContent = '';
        frontId = null;
      }
    }

    function focusId(id: string) {
      const obj = objects.find((entry) => (entry.element as HTMLElement).dataset.id === id);
      if (!obj) return;
      localDir.copy(obj.position).normalize();
      fromQ.copy(scene.quaternion);
      toQ.setFromUnitVectors(localDir, FRONT);
      idleAt = performance.now();
      velSpeed = 0;
      if (reduceMotion) {
        scene.quaternion.copy(toQ);
        return;
      }
      focus = { t: 0 };
    }

    fill();
    resize();

    const onDown = (event: PointerEvent) => {
      if (!enabledRef.current) return;
      dragging = true;
      moved = false;
      lastX = event.clientX;
      lastY = event.clientY;
      downAt = performance.now();
      idleAt = downAt;
      velSpeed = 0;
      focus = null;
      el.setPointerCapture(event.pointerId);
    };

    const onMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.hypot(dx, dy) > 7) moved = true;
      lastX = event.clientX;
      lastY = event.clientY;
      idleAt = performance.now();
      tumble(dx, dy);
    };

    const onUp = (event: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* already released */
      }
      if (!enabledRef.current) return;
      if (moved || performance.now() - downAt > 700) return;
      const hit = document.elementFromPoint(event.clientX, event.clientY);
      const card = hit instanceof Element ? hit.closest('.globe-card') : null;
      if (card instanceof HTMLElement) card.click();
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!enabledRef.current) return;
      idleAt = performance.now();
      const factor = event.deltaY > 0 ? 1.08 : 0.93;
      distance = clamp(distance * factor, radius * 2.05, radius * 5.2);
      camera.position.set(0, 0, distance);
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(resize);
    ro.observe(el);

    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const live = enabledRef.current;
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;

      if (live && focus) {
        focus.t = Math.min(1, focus.t + dt / 0.52);
        scene.quaternion.copy(fromQ).slerp(toQ, easeOut(focus.t));
        if (focus.t >= 1) focus = null;
      } else if (live && !dragging) {
        if (!reduceMotion) {
          if (velSpeed > 0.0002) {
            dragQ.setFromAxisAngle(velAxis, velSpeed);
            scene.quaternion.premultiply(dragQ);
            velSpeed *= 0.94;
          } else {
            velSpeed = 0;
          }
          if (now - idleAt > 2400) {
            spinQ.setFromAxisAngle(AXIS_Y, 0.18 * dt);
            scene.quaternion.premultiply(spinQ);
          }
        }
      }

      applyView();
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      for (const obj of objects) scene.remove(obj);
      scene.remove(coreObj);
      renderer.domElement.remove();
    };
    // items is captured with this itemKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey]);

  return (
    <div className="globe-stage">
      <div
        ref={hostRef}
        className="globe-host"
        role="application"
        aria-label="출력 기록을 구 위에 붙여 사방으로 굴릴 수 있습니다"
      />
      <div ref={hudRef} className="globe-hud" />
    </div>
  );
}
