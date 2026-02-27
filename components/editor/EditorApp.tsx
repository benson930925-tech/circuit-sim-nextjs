"use client";

import React, { useMemo, useReducer, useState } from "react";
import CircuitCanvas from "./CircuitCanvas";
import Inspector from "./Inspector";
import type { CircuitDoc, Tool, Element, Wire, Junction } from "@/lib/circuit/types";
import { buildNet } from "@/lib/circuit/buildNet";
import { solveMNA } from "@/lib/circuit/solve";

function uid(prefix: string) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10);
}

const DEFAULT_GRID = 20;

const initialDoc: CircuitDoc = {
  version: 1,
  grid: DEFAULT_GRID,
  freqHz: 60,
  elements: [{ id: "gnd_1", type: "GND", name: "GND", p: { x: 360, y: 340 }, x: 360, y: 360 }],
  wires: [],
  junctions: [],
};

type Selection =
  | { kind: "none" }
  | { kind: "element"; id: string }
  | { kind: "wire"; id: string }
  | { kind: "junction"; id: string };

type Action =
  | { type: "SET_TOOL"; tool: Tool }
  | { type: "SET_DOC"; doc: CircuitDoc }
  | { type: "ADD_ELEMENT"; el: Element }
  | { type: "UPDATE_ELEMENT"; id: string; patch: any }
  | { type: "MOVE_ELEMENT"; id: string; dx: number; dy: number; grid: number }
  | { type: "DELETE_ELEMENT"; id: string }
  | { type: "ADD_WIRE"; wire: Wire }
  | { type: "UPDATE_WIRE"; id: string; points: Wire["points"] }
  | { type: "DELETE_WIRE"; id: string }
  | { type: "ADD_JUNCTION"; j: Junction }
  | { type: "MOVE_JUNCTION"; id: string; dx: number; dy: number; grid: number }
  | { type: "DELETE_JUNCTION"; id: string };

type State = { tool: Tool; doc: CircuitDoc };

function snap(v: number, grid: number) {
  return Math.round(v / grid) * grid;
}

function reducer(state: State, action: Action): State {
  const { doc } = state;
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, tool: action.tool };
    case "SET_DOC":
      return { ...state, doc: action.doc };
    case "ADD_ELEMENT":
      return { ...state, doc: { ...doc, elements: [...doc.elements, action.el] } };

    case "UPDATE_ELEMENT": {
      return {
        ...state,
        doc: {
          ...doc,
          elements: doc.elements.map((e) => {
            if (e.id !== action.id) return e;
            const next: any = { ...e, ...action.patch };

            if (next.type !== "GND") {
              const L = 160;
              const half = L / 2;
              const rot = next.rotation ?? 0;
              const x = next.x ?? e.x;
              const y = next.y ?? e.y;

              const a =
                rot === 0
                  ? { x: x - half, y }
                  : rot === 180
                  ? { x: x + half, y }
                  : rot === 90
                  ? { x, y: y - half }
                  : { x, y: y + half };
              const b =
                rot === 0
                  ? { x: x + half, y }
                  : rot === 180
                  ? { x: x - half, y }
                  : rot === 90
                  ? { x, y: y + half }
                  : { x, y: y - half };
              next.a = a;
              next.b = b;
            } else {
              const x = next.x ?? e.x;
              const y = next.y ?? e.y;
              next.p = { x, y: y - 20 };
            }

            return next as any;
          }),
        },
      };
    }

    case "MOVE_ELEMENT": {
      const grid = action.grid;
      return {
        ...state,
        doc: {
          ...doc,
          elements: doc.elements.map((e: any) => {
            if (e.id !== action.id) return e;

            if (e.type === "GND") {
              const x = snap(e.x + action.dx, grid);
              const y = snap(e.y + action.dy, grid);
              const p = { x, y: y - 20 };
              return { ...e, x, y, p };
            } else {
              const x = snap(e.x + action.dx, grid);
              const y = snap(e.y + action.dy, grid);

              const L = 160;
              const half = L / 2;
              const rot = e.rotation;

              const a =
                rot === 0
                  ? { x: x - half, y }
                  : rot === 180
                  ? { x: x + half, y }
                  : rot === 90
                  ? { x, y: y - half }
                  : { x, y: y + half };
              const b =
                rot === 0
                  ? { x: x + half, y }
                  : rot === 180
                  ? { x: x - half, y }
                  : rot === 90
                  ? { x, y: y + half }
                  : { x, y: y - half };

              return { ...e, x, y, a, b };
            }
          }),
        },
      };
    }

    case "DELETE_ELEMENT":
      return { ...state, doc: { ...doc, elements: doc.elements.filter((e) => e.id !== action.id) } };

    case "ADD_WIRE":
      return { ...state, doc: { ...doc, wires: [...doc.wires, action.wire] } };

    case "UPDATE_WIRE":
      return {
        ...state,
        doc: { ...doc, wires: doc.wires.map((w) => (w.id === action.id ? { ...w, points: action.points } : w)) },
      };

    case "DELETE_WIRE":
      return { ...state, doc: { ...doc, wires: doc.wires.filter((w) => w.id !== action.id) } };

    case "ADD_JUNCTION":
      return { ...state, doc: { ...doc, junctions: [...doc.junctions, action.j] } };

    case "MOVE_JUNCTION": {
      const grid = action.grid;
      return {
        ...state,
        doc: {
          ...doc,
          junctions: doc.junctions.map((j) =>
            j.id === action.id ? { ...j, p: { x: snap(j.p.x + action.dx, grid), y: snap(j.p.y + action.dy, grid) } } : j
          ),
        },
      };
    }

    case "DELETE_JUNCTION":
      return { ...state, doc: { ...doc, junctions: doc.junctions.filter((j) => j.id !== action.id) } };

    default:
      return state;
  }
}

export default function EditorApp() {
  const [state, dispatch] = useReducer(reducer, { tool: "select", doc: initialDoc });
  const [selection, setSelection] = useState<Selection>({ kind: "none" });

  const [solveErr, setSolveErr] = useState<string>("");
  const [solution, setSolution] = useState<any>(null);
  const [nodePoints, setNodePoints] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [builtNet, setBuiltNet] = useState<any>(null);

  const [ioText, setIoText] = useState<string>("");

  // 量測端口（node id）
  const [measure, setMeasure] = useState<{ a?: string; b?: string }>({});

  // 可選：指定某個元件為 ZL（算 Vth/Zth 時會先移除它）
  const [loadElementId, setLoadElementId] = useState<string | null>(null);

  const grid = state.doc.grid;

  const toolLabel = (t: any) => {
    const map: Record<string, string> = {
      select: "選取",
      wire: "導線",
      junction: "節點",
      measure_V: "量測/端口",
      place_R: "放置電阻",
      place_C: "放置電容",
      place_L: "放置電感",
      place_V: "放置電壓源",
      place_I: "放置電流源",
      place_GND: "放置接地",
      pan: "平移",
    };
    return map[t] ?? t;
  };

  const onSolve = () => {
    setSolveErr("");
    const built = buildNet(state.doc);
    if (!built.ok) {
      setSolution(null);
      setNodePoints(null);
      setBuiltNet(null);
      setSolveErr(built.error);
      return;
    }
    const res = solveMNA(built.net, state.doc.freqHz);
    if (!res.ok) {
      setSolution(null);
      setNodePoints(null);
      setBuiltNet(null);
      setSolveErr(res.error ?? "Solve failed");
      return;
    }
    setSolution(res);
    setNodePoints(built.nodePoints);
    setBuiltNet(built.net);
  };

  const onExport = () => setIoText(JSON.stringify(state.doc, null, 2));

  const onImport = () => {
    try {
      const parsed = JSON.parse(ioText) as CircuitDoc;
      if (!parsed || parsed.version !== 1) throw new Error("Invalid doc");
      if (typeof (parsed as any).freqHz !== "number") (parsed as any).freqHz = 0;
      dispatch({ type: "SET_DOC", doc: parsed });
      setSelection({ kind: "none" });
      setSolveErr("");
      setSolution(null);
      setNodePoints(null);
      setBuiltNet(null);
      setMeasure({});
      setLoadElementId(null);
    } catch {
      setSolveErr("匯入失敗：JSON 格式或 version 不正確。");
    }
  };

  const addElementAt = (type: "R" | "C" | "L" | "V" | "I" | "GND", x: number, y: number) => {
    const sx = snap(x, grid);
    const sy = snap(y, grid);

    if (type === "GND") {
      const el: any = { id: uid("gnd"), type: "GND", name: "GND", p: { x: sx, y: sy - 20 }, x: sx, y: sy };
      dispatch({ type: "ADD_ELEMENT", el });
      setSelection({ kind: "element", id: el.id });
      return;
    }

    const Lsym = 160;
    const half = Lsym / 2;
    const rot: 0 | 90 | 180 | 270 = 0;

    const el: any = {
      id: uid(type.toLowerCase()),
      type,
      name: `${type}${Math.floor(Math.random() * 9 + 1)}`,
      value: type === "R" ? "1k" : type === "C" ? "1u" : type === "L" ? "1m" : type === "V" ? "5" : "1m",
      rotation: rot,
      x: sx,
      y: sy,
      a: { x: sx - half, y: sy },
      b: { x: sx + half, y: sy },
    };

    dispatch({ type: "ADD_ELEMENT", el });
    setSelection({ kind: "element", id: el.id });
  };

  const selectedElement = useMemo(() => {
    if (selection.kind !== "element") return null;
    return state.doc.elements.find((e) => e.id === selection.id) ?? null;
  }, [selection, state.doc.elements]);

  const selectedWire = useMemo(() => {
    if (selection.kind !== "wire") return null;
    return state.doc.wires.find((w) => w.id === selection.id) ?? null;
  }, [selection, state.doc.wires]);

  const selectedJunction = useMemo(() => {
    if (selection.kind !== "junction") return null;
    return state.doc.junctions.find((j) => j.id === selection.id) ?? null;
  }, [selection, state.doc.junctions]);

  return (
    <div className="appShell">
      <div className="panel">
        <div className="header">工具</div>
        <div className="sub">R/C/L/V/I/GND + 導線 + 節點 + MNA solver（DC/AC 相量）。</div>

        <div className="btnRow">
          <button className={"btn " + (state.tool === "select" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "select" })}>
            選取
          </button>
          <button className={"btn secondary " + (state.tool === "wire" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "wire" })}>
            導線
          </button>
          <button className={"btn secondary " + (state.tool === "junction" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "junction" })}>
            節點
          </button>
          <button
            className={"btn secondary " + (state.tool === "measure_V" ? "active" : "")}
            onClick={() => {
              dispatch({ type: "SET_TOOL", tool: "measure_V" });
              setMeasure({});
            }}
          >
            量測/端口
          </button>
        </div>

        <div className="btnRow">
          <button className={"btn " + (state.tool === "place_R" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_R" })}>
            放置電阻
          </button>
          <button className={"btn " + (state.tool === "place_C" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_C" })}>
            放置電容
          </button>
          <button className={"btn " + (state.tool === "place_L" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_L" })}>
            放置電感
          </button>
          <button className={"btn " + (state.tool === "place_V" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_V" })}>
            放置電壓源
          </button>
          <button className={"btn " + (state.tool === "place_I" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_I" })}>
            放置電流源
          </button>
          <button className={"btn " + (state.tool === "place_GND" ? "active" : "")} onClick={() => dispatch({ type: "SET_TOOL", tool: "place_GND" })}>
            放置接地
          </button>
        </div>

        <div className="hr" />
        <div className="kv" style={{ marginTop: 10 }}>
          <label>頻率 (Hz)</label>
          <input
            value={String(state.doc.freqHz)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v < 0) return;
              dispatch({ type: "SET_DOC", doc: { ...state.doc, freqHz: v } });
            }}
          />
        </div>

        <div className="btnRow" style={{ marginTop: 10 }}>
          <button className="btn" onClick={onSolve}>
            求解
          </button>
          <button className="btn secondary" onClick={onExport}>
            匯出
          </button>
          <button className="btn secondary" onClick={onImport}>
            匯入
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <textarea value={ioText} onChange={(e) => setIoText(e.target.value)} placeholder="匯出會把 JSON 放在這裡；貼上 JSON 後按「匯入」。" />
        </div>

        {solveErr ? <div className="err" style={{ marginTop: 10 }}>⚠️ {solveErr}</div> : null}

        <div className="hr" />
        <div className="note">
          <div style={{ fontWeight: 700, marginBottom: 6 }}>操作</div>
          <div>• 平移：按住 <span className="mono">Space</span> 拖曳</div>
          <div>• 縮放：<span className="mono">Ctrl</span> + 滾輪</div>
          <div>• Delete：刪除選取</div>
          <div style={{ marginTop: 8 }}>量測/端口：點兩個節點 A/B，右側可算 Vth/Zth/ZLopt/Pmax。</div>
        </div>
      </div>

      <div className="canvasWrap">
        <div className="topBar">
          <div className="pill">
            工具： <span className="mono">{toolLabel(state.tool)}</span>
          </div>
          <div className="pill">
            格點： <span className="mono">{grid}px</span>
          </div>
          {solution?.ok ? <div className="pill">已求解 ✅</div> : <div className="pill">未求解</div>}
        </div>

        <CircuitCanvas
          doc={state.doc}
          tool={state.tool}
          selection={selection}
          setSelection={setSelection}
          dispatch={dispatch}
          addElementAt={addElementAt}
          solved={solution?.ok ? solution : null}
          nodePoints={nodePoints}
          measure={measure}
          setMeasure={setMeasure}
        />
      </div>

      <div className="panel panelRight">
        <div className="header">屬性面板</div>
        <Inspector
          grid={grid}
          selection={selection}
          element={selectedElement}
          wire={selectedWire}
          junction={selectedJunction}
          solution={solution}
          builtNet={builtNet}
          freqHz={state.doc.freqHz}
          measure={measure}
          loadElementId={loadElementId}
          onSetLoad={(id) => setLoadElementId(id)}
          onClearLoad={() => setLoadElementId(null)}
          onClearMeasure={() => setMeasure({})}
          onUpdateElement={(id, patch) => dispatch({ type: "UPDATE_ELEMENT", id, patch })}
          onDeleteSelected={() => {
            if (selection.kind === "element") dispatch({ type: "DELETE_ELEMENT", id: selection.id });
            if (selection.kind === "wire") dispatch({ type: "DELETE_WIRE", id: selection.id });
            if (selection.kind === "junction") dispatch({ type: "DELETE_JUNCTION", id: selection.id });
            setSelection({ kind: "none" });
          }}
        />
      </div>
    </div>
  );
}