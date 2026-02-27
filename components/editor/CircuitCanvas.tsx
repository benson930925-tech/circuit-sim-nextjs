"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Line, Circle, Text, Group } from "react-konva";
import type { CircuitDoc, Tool, Element, Wire, Junction, Point } from "@/lib/circuit/types";
import { fmtCx } from "@/lib/circuit/complex";

type Selection =
  | { kind: "none" }
  | { kind: "element"; id: string }
  | { kind: "wire"; id: string }
  | { kind: "junction"; id: string };

type Dispatch = (action: any) => void;

function snap(v: number, grid: number) {
  return Math.round(v / grid) * grid;
}
function snapPoint(p: Point, grid: number): Point {
  return { x: snap(p.x, grid), y: snap(p.y, grid) };
}
function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export default function CircuitCanvas(props: {
  doc: CircuitDoc;
  tool: Tool;
  selection: Selection;
  setSelection: (s: Selection) => void;
  dispatch: Dispatch;
  addElementAt: (type: "R" | "C" | "L" | "V" | "I" | "GND", x: number, y: number) => void;
  solved: any | null;
  nodePoints: Record<string, Point> | null;

  // 量測 A/B
  measure: { a?: string; b?: string };
  setMeasure: (m: { a?: string; b?: string }) => void;
}) {
  const { doc, tool, selection, setSelection, dispatch, addElementAt, solved, nodePoints, measure, setMeasure } = props;
  const grid = doc.grid;

  const stageRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [stageSize, setStageSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });

  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ sx: number; sy: number; vx: number; vy: number } | null>(null);

  const [wireDraft, setWireDraft] = useState<{ start: Point; current: Point } | null>(null);

  // Resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setStageSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keys（輸入框內按 Backspace/Delete 不刪元件）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(true);
      if (e.code === "Escape") setWireDraft(null);

      const isTyping =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);

      if ((e.code === "Delete" || e.code === "Backspace") && !isTyping) {
        if (selection.kind === "element") dispatch({ type: "DELETE_ELEMENT", id: selection.id });
        if (selection.kind === "wire") dispatch({ type: "DELETE_WIRE", id: selection.id });
        if (selection.kind === "junction") dispatch({ type: "DELETE_JUNCTION", id: selection.id });
        setSelection({ kind: "none" });
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [dispatch, selection, setSelection]);

  const toWorld = (pt: { x: number; y: number }): Point => ({
    x: (pt.x - view.x) / view.scale,
    y: (pt.y - view.y) / view.scale,
  });

  const findSnapTarget = (p: Point): Point => {
    const sp = snapPoint(p, grid);
    const tol2 = Math.max(36, Math.floor(grid * 0.5) ** 2);
    let best = sp;
    let bestD = Infinity;

    const candidates: Point[] = [];
    for (const el of doc.elements) {
      if ((el as any).type === "GND") candidates.push((el as any).p);
      else {
        candidates.push((el as any).a);
        candidates.push((el as any).b);
      }
    }
    for (const j of doc.junctions) candidates.push(j.p);

    for (const c of candidates) {
      const d = dist2(sp, c);
      if (d < bestD && d <= tol2) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const makeOrthogonal = (a: Point, b: Point): Point[] => {
    const elbow1 = { x: b.x, y: a.y };
    const elbow2 = { x: a.x, y: b.y };
    const len1 =
      Math.abs(a.x - elbow1.x) +
      Math.abs(a.y - elbow1.y) +
      Math.abs(elbow1.x - b.x) +
      Math.abs(elbow1.y - b.y);
    const len2 =
      Math.abs(a.x - elbow2.x) +
      Math.abs(a.y - elbow2.y) +
      Math.abs(elbow2.x - b.x) +
      Math.abs(elbow2.y - b.y);
    const elbow = len1 <= len2 ? elbow1 : elbow2;
    if ((elbow.x === a.x && elbow.y === a.y) || (elbow.x === b.x && elbow.y === b.y)) return [a, b];
    return [a, elbow, b];
  };

  const getGroundPoint = (): Point | null => {
    const g = doc.elements.find((e) => (e as any).type === "GND") as any;
    return g?.p ?? null;
  };

  // 量測用：找最近 node id（nodePoints + gnd）
  const findNearestNodeId = (world: Point): string | null => {
    const tol2 = Math.max(64, Math.floor(grid * 0.8) ** 2);
    const cand: Record<string, Point> = {};
    if (nodePoints) for (const [k, p] of Object.entries(nodePoints)) cand[k] = p;
    const gpt = getGroundPoint();
    if (gpt) cand["gnd"] = gpt;

    let bestId: string | null = null;
    let bestD = Infinity;
    for (const [id, p] of Object.entries(cand)) {
      const d = dist2(world, p);
      if (d < bestD && d <= tol2) {
        bestD = d;
        bestId = id;
      }
    }
    return bestId;
  };

  const onWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    if (!e.evt.ctrlKey) return;

    const oldScale = view.scale;
    const scaleBy = 1.05;
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy;

    const mousePointTo = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale };
    const newPos = { x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale };

    setView({ x: newPos.x, y: newPos.y, scale: Math.max(0.25, Math.min(3.5, newScale)) });
  };

  const onMouseDown = (e: any) => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    if (spaceDown) {
      setPanning(true);
      setPanStart({ sx: pos.x, sy: pos.y, vx: view.x, vy: view.y });
      return;
    }

    const world = toWorld(pos);

    if (e.target === stage) {
      // 量測/端口：點兩個節點 A/B
      if (tool === "measure_V") {
        const nid = findNearestNodeId(world);
        if (!nid) return;

        if (!measure.a || (measure.a && measure.b)) setMeasure({ a: nid, b: undefined });
        else setMeasure({ a: measure.a, b: nid });
        return;
      }

      if (tool === "place_R") addElementAt("R", world.x, world.y);
      else if (tool === "place_C") addElementAt("C", world.x, world.y);
      else if (tool === "place_L") addElementAt("L", world.x, world.y);
      else if (tool === "place_V") addElementAt("V", world.x, world.y);
      else if (tool === "place_I") addElementAt("I", world.x, world.y);
      else if (tool === "place_GND") addElementAt("GND", world.x, world.y);
      else if (tool === "junction") {
        const p = findSnapTarget(world);
        dispatch({ type: "ADD_JUNCTION", j: { id: "j_" + Math.random().toString(36).slice(2, 9), p } });
        setSelection({ kind: "none" });
      } else if (tool === "wire") {
        const p = findSnapTarget(world);
        if (!wireDraft) setWireDraft({ start: p, current: p });
        else {
          const end = findSnapTarget(world);
          const pts = makeOrthogonal(wireDraft.start, end);
          const id = "w_" + Math.random().toString(36).slice(2, 9);
          dispatch({ type: "ADD_WIRE", wire: { id, points: pts } });
          setWireDraft(null);
          setSelection({ kind: "wire", id });
        }
      } else {
        setSelection({ kind: "none" });
      }
    }
  };

  const onMouseMove = (e: any) => {
    const stage = stageRef.current;
    const pos = stage?.getPointerPosition();
    if (!pos) return;

    if (panning && panStart) {
      const dx = pos.x - panStart.sx;
      const dy = pos.y - panStart.sy;
      setView({ ...view, x: panStart.vx + dx, y: panStart.vy + dy });
      return;
    }

    if (wireDraft) {
      const w = toWorld(pos);
      setWireDraft({ ...wireDraft, current: findSnapTarget(w) });
    }
  };

  const onMouseUp = () => {
    setPanning(false);
    setPanStart(null);
  };

  // Grid
  const gridLines = useMemo(() => {
    const lines: { points: number[] }[] = [];
    const inv = 1 / view.scale;
    const padding = 200 * inv;
    const left = -view.x / view.scale - padding;
    const top = -view.y / view.scale - padding;
    const right = (stageSize.w - view.x) / view.scale + padding;
    const bottom = (stageSize.h - view.y) / view.scale + padding;

    const startX = Math.floor(left / grid) * grid;
    const endX = Math.ceil(right / grid) * grid;
    const startY = Math.floor(top / grid) * grid;
    const endY = Math.ceil(bottom / grid) * grid;

    for (let x = startX; x <= endX; x += grid) lines.push({ points: [x, startY, x, endY] });
    for (let y = startY; y <= endY; y += grid) lines.push({ points: [startX, y, endX, y] });

    return lines;
  }, [grid, view.x, view.y, view.scale, stageSize.w, stageSize.h]);

  const wireDraftPts = useMemo(() => {
    if (!wireDraft) return null;
    return makeOrthogonal(wireDraft.start, wireDraft.current);
  }, [wireDraft]);

  const drawWire = (w: Wire, isSelected: boolean) => (
    <Line
      key={w.id}
      points={w.points.flatMap((p) => [p.x, p.y])}
      stroke={isSelected ? "#7dd3fc" : "#cbd5e1"}
      strokeWidth={isSelected ? 4 : 3}
      lineCap="round"
      lineJoin="round"
      onMouseDown={(e) => {
        e.cancelBubble = true;
        setSelection({ kind: "wire", id: w.id });
      }}
    />
  );

  const drawJunction = (j: Junction, isSelected: boolean) => (
    <Circle
      key={j.id}
      x={j.p.x}
      y={j.p.y}
      radius={isSelected ? 6 : 5}
      fill={isSelected ? "#7dd3fc" : "#e2e8f0"}
      stroke="#0b1220"
      strokeWidth={2}
      draggable={tool === "select"}
      onDragMove={(e) => e.target.position({ x: snap(e.target.x(), grid), y: snap(e.target.y(), grid) })}
      onDragEnd={(e) => {
        const nx = snap(e.target.x(), grid);
        const ny = snap(e.target.y(), grid);
        dispatch({ type: "MOVE_JUNCTION", id: j.id, dx: nx - j.p.x, dy: ny - j.p.y, grid });
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        setSelection({ kind: "junction", id: j.id });
      }}
    />
  );

  const drawElement = (el: Element, isSelected: boolean) => {
    const type = (el as any).type;

    if (type === "GND") {
      const stroke = isSelected ? "#7dd3fc" : "#e2e8f0";
      const g = el as any;
      return (
        <Group
          key={g.id}
          x={g.x}
          y={g.y}
          draggable={tool === "select"}
          onDragMove={(e) => e.target.position({ x: snap(e.target.x(), grid), y: snap(e.target.y(), grid) })}
          onDragEnd={(e) => {
            const nx = snap(e.target.x(), grid);
            const ny = snap(e.target.y(), grid);
            dispatch({ type: "MOVE_ELEMENT", id: g.id, dx: nx - g.x, dy: ny - g.y, grid });
          }}
          onMouseDown={(e) => {
            e.cancelBubble = true;
            setSelection({ kind: "element", id: g.id });
          }}
        >
          <Text text={g.name} x={-18} y={-34} fontSize={12} fill="#9fb0d0" />
          <Circle x={g.p.x - g.x} y={g.p.y - g.y} radius={6} fill="#0b1220" stroke={stroke} strokeWidth={2} />
          <Line points={[0, -10, 0, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[-14, 0, 14, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[-10, 8, 10, 8]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[-6, 16, 6, 16]} stroke={stroke} strokeWidth={3} lineCap="round" />
        </Group>
      );
    }

    const e = el as any;
    const stroke = isSelected ? "#7dd3fc" : "#e2e8f0";
    const cx0 = e.x;
    const cy0 = e.y;
    const rot = e.rotation;

    const symbol = (() => {
      if (type === "R") {
        const lead = 80;
        const z0 = -40;
        const z1 = 40;
        const zz = [z0, 0, z0 + 10, -10, z0 + 20, 10, z0 + 30, -10, z0 + 40, 10, z0 + 50, -10, z1, 0];
        return (
          <Group rotation={rot} x={cx0} y={cy0}>
            <Text text={e.name} x={-18} y={-34} fontSize={12} fill="#9fb0d0" />
            <Line points={[-lead, 0, z0, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={zz} stroke={stroke} strokeWidth={3} lineCap="round" lineJoin="round" />
            <Line points={[z1, 0, lead, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Text text={`${e.value}`} x={-34} y={14} fontSize={12} fill="#9fb0d0" />
          </Group>
        );
      }
      if (type === "C") {
        return (
          <Group rotation={rot} x={cx0} y={cy0}>
            <Text text={e.name} x={-18} y={-34} fontSize={12} fill="#9fb0d0" />
            <Line points={[-80, 0, -16, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={[16, 0, 80, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={[-16, -18, -16, 18]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={[16, -18, 16, 18]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Text text={`${e.value}`} x={-34} y={14} fontSize={12} fill="#9fb0d0" />
          </Group>
        );
      }
      if (type === "L") {
        return (
          <Group rotation={rot} x={cx0} y={cy0}>
            <Text text={e.name} x={-18} y={-34} fontSize={12} fill="#9fb0d0" />
            <Line points={[-80, 0, -44, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={[44, 0, 80, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line
              points={[
                -44, 0, -36, -14, -24, -14, -16, 0, -8, -14, 4, -14, 12, 0, 20, -14, 32, -14, 40, 0, 44, 0,
              ]}
              stroke={stroke}
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
            <Text text={`${e.value}`} x={-34} y={14} fontSize={12} fill="#9fb0d0" />
          </Group>
        );
      }
      if (type === "V") {
        return (
          <Group rotation={rot} x={cx0} y={cy0}>
            <Text text={e.name} x={-18} y={-44} fontSize={12} fill="#9fb0d0" />
            <Line points={[-80, 0, -26, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Line points={[26, 0, 80, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
            <Circle x={0} y={0} radius={26} stroke={stroke} strokeWidth={3} />
            <Text text="+" x={-6} y={-20} fontSize={18} fill={stroke} />
            <Text text="–" x={-5} y={6} fontSize={18} fill={stroke} />
            <Text text={`${e.value}`} x={-34} y={34} fontSize={12} fill="#9fb0d0" />
          </Group>
        );
      }
      // I
      return (
        <Group rotation={rot} x={cx0} y={cy0}>
          <Text text={e.name} x={-18} y={-44} fontSize={12} fill="#9fb0d0" />
          <Line points={[-80, 0, -26, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[26, 0, 80, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Circle x={0} y={0} radius={26} stroke={stroke} strokeWidth={3} />
          <Line points={[-10, 0, 10, 0]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[10, 0, 2, -6]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Line points={[10, 0, 2, 6]} stroke={stroke} strokeWidth={3} lineCap="round" />
          <Text text={`${e.value}`} x={-34} y={34} fontSize={12} fill="#9fb0d0" />
        </Group>
      );
    })();

    return (
      <Group
        key={e.id}
        onMouseDown={(ev) => {
          ev.cancelBubble = true;
          setSelection({ kind: "element", id: e.id });
        }}
      >
        {/* endpoints */}
        <Circle x={e.a.x} y={e.a.y} radius={6} fill="#0b1220" stroke={stroke} strokeWidth={2} />
        <Circle x={e.b.x} y={e.b.y} radius={6} fill="#0b1220" stroke={stroke} strokeWidth={2} />

        {/* ✅ a/b labels: a=+端、b=-端（Va - Vb = value） */}
        <Text x={e.a.x + 8} y={e.a.y - 10} text="a(+)" fontSize={12} fill="#e2e8f0" />
        <Text x={e.b.x + 8} y={e.b.y - 10} text="b(-)" fontSize={12} fill="#e2e8f0" />

        {/* drag hit area */}
        <Group
          x={cx0}
          y={cy0}
          draggable={tool === "select"}
          onDragMove={(ev) => ev.target.position({ x: snap(ev.target.x(), grid), y: snap(ev.target.y(), grid) })}
          onDragEnd={(ev) => {
            const nx = snap(ev.target.x(), grid);
            const ny = snap(ev.target.y(), grid);
            dispatch({ type: "MOVE_ELEMENT", id: e.id, dx: nx - e.x, dy: ny - e.y, grid });
          }}
        >
          <Circle
            x={0}
            y={0}
            radius={58}
            stroke={isSelected ? "rgba(125,211,252,.35)" : "rgba(0,0,0,0)"}
            strokeWidth={18}
          />
        </Group>

        {symbol}
      </Group>
    );
  };

  // Node labels
  const nodeLabels = useMemo(() => {
    if (!solved?.ok || !nodePoints) return null;
    const vols = solved.nodeVoltages as Record<string, { re: number; im: number }>;
    return Object.entries(nodePoints)
      .filter(([id]) => id !== "gnd")
      .map(([id, p]) => {
        const v = vols?.[id];
        if (!v) return null;
        return <Text key={id} x={p.x + 8} y={p.y - 18} text={`${id}: ${fmtCx(v)} V`} fontSize={12} fill="#7dd3fc" />;
      });
  }, [solved, nodePoints]);

  // Element current labels
  const elemLabels = useMemo(() => {
    if (!solved?.ok) return null;
    const cur = solved.elementCurrents as Record<string, { re: number; im: number }>;
    return doc.elements.map((el) => {
      const id = (el as any).id;
      const type = (el as any).type;
      const i = cur?.[id];
      if (!i) return null;

      const p =
        type === "GND"
          ? { x: (el as any).x, y: (el as any).y }
          : { x: (((el as any).a.x + (el as any).b.x) / 2) as number, y: (((el as any).a.y + (el as any).b.y) / 2) as number };

      return <Text key={id} x={p.x + 8} y={p.y + 10} text={`I=${fmtCx(i)}A`} fontSize={12} fill="#cbd5e1" />;
    });
  }, [solved, doc.elements]);

  // Measure markers
  const measureMarkers = useMemo(() => {
    const cand: Record<string, Point> = {};
    if (nodePoints) for (const [k, p] of Object.entries(nodePoints)) cand[k] = p;
    const gpt = getGroundPoint();
    if (gpt) cand["gnd"] = gpt;

    const A = measure.a ? cand[measure.a] : null;
    const B = measure.b ? cand[measure.b] : null;

    return (
      <Group listening={false}>
        {A ? <Circle x={A.x} y={A.y} radius={10} stroke="#22c55e" strokeWidth={3} /> : null}
        {A ? <Text x={A.x + 12} y={A.y - 10} text={`A(${measure.a})`} fontSize={12} fill="#22c55e" /> : null}

        {B ? <Circle x={B.x} y={B.y} radius={10} stroke="#f97316" strokeWidth={3} /> : null}
        {B ? <Text x={B.x + 12} y={B.y - 10} text={`B(${measure.b})`} fontSize={12} fill="#f97316" /> : null}

        {A && B ? <Line points={[A.x, A.y, B.x, B.y]} stroke="rgba(34,197,94,.6)" strokeWidth={3} dash={[10, 8]} /> : null}
      </Group>
    );
  }, [measure, nodePoints, doc.elements]);

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <Stage
        ref={stageRef}
        width={stageSize.w}
        height={stageSize.h}
        x={view.x}
        y={view.y}
        scaleX={view.scale}
        scaleY={view.scale}
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        style={{ background: "transparent" }}
      >
        <Layer listening={false}>
          {gridLines.map((l, idx) => (
            <Line key={idx} points={l.points} stroke="rgba(148,163,184,.14)" strokeWidth={1} />
          ))}
        </Layer>

        <Layer>
          {doc.wires.map((w) => drawWire(w, selection.kind === "wire" && selection.id === w.id))}
          {wireDraftPts ? (
            <Line
              points={wireDraftPts.flatMap((p) => [p.x, p.y])}
              stroke="rgba(125,211,252,.8)"
              strokeWidth={3}
              dash={[10, 8]}
            />
          ) : null}
        </Layer>

        <Layer>
          {doc.junctions.map((j) => drawJunction(j, selection.kind === "junction" && selection.id === j.id))}
        </Layer>

        <Layer>
          {doc.elements.map((el) => drawElement(el, selection.kind === "element" && selection.id === (el as any).id))}
        </Layer>

        <Layer listening={false}>
          {nodeLabels}
          {elemLabels}
          {measureMarkers}
        </Layer>
      </Stage>
    </div>
  );
}