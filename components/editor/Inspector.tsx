"use client";

import React, { useMemo, useState } from "react";
import type { Element, Wire, Junction } from "@/lib/circuit/types";
import { fmtCx } from "@/lib/circuit/complex";
import { solveMNA } from "@/lib/circuit/solve";

type Selection =
  | { kind: "none" }
  | { kind: "element"; id: string }
  | { kind: "wire"; id: string }
  | { kind: "junction"; id: string };

type Cx = { re: number; im: number };

const cx = (re: number, im = 0): Cx => ({ re, im });
const sub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const div = (a: Cx, b: Cx): Cx => {
  const d = b.re * b.re + b.im * b.im;
  if (d === 0) return { re: NaN, im: NaN };
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const conj = (a: Cx): Cx => ({ re: a.re, im: -a.im });
const abs = (a: Cx) => Math.hypot(a.re, a.im);

function round(v: number, digits = 6) {
  const s = Math.pow(10, digits);
  return Math.round(v * s) / s;
}
function fmtNum(v: number) {
  return Number.isFinite(v) ? String(round(v, 6)) : "—";
}

export default function Inspector(props: {
  grid: number;
  selection: Selection;
  element: Element | null;
  wire: Wire | null;
  junction: Junction | null;

  // 主求解結果（EditorApp 按「求解」後）
  solution: any;

  // buildNet(net) 的 net（EditorApp 傳進來）
  builtNet: any | null;

  freqHz: number;

  // 量測端口 A/B (node id)
  measure?: { a?: string; b?: string };

  // 可選：指定負載元件 id（計算 Vth/Zth 前會暫時移除）
  loadElementId?: string | null;

  onSetLoad?: (id: string) => void;
  onClearLoad?: () => void;
  onClearMeasure?: () => void;

  onUpdateElement: (id: string, patch: any) => void;
  onDeleteSelected: () => void;
}) {
  const { selection, element, wire, junction, solution, builtNet, freqHz } = props;
  const measure = props.measure ?? {};
  const loadElementId = props.loadElementId ?? null;

  const current = useMemo(() => {
    if (selection.kind === "element" && element) return { kind: "element" as const, element };
    if (selection.kind === "wire" && wire) return { kind: "wire" as const, wire };
    if (selection.kind === "junction" && junction) return { kind: "junction" as const, junction };
    return { kind: "none" as const };
  }, [selection, element, wire, junction]);

  const [portReport, setPortReport] = useState<string>("");

  // --- 元件編輯區 ---
  const renderElementEditor = () => {
    if (current.kind !== "element") return null;
    const el: any = current.element;

    return (
      <div>
        <div className="note">
          已選取：<span className="mono">{el.name}</span>（{el.type}）
        </div>

        {el.type !== "GND" ? (
          <>
            <div className="kv">
              <label>數值</label>
              <input value={String(el.value ?? "")} onChange={(e) => props.onUpdateElement(el.id, { value: e.target.value })} />

              <label>旋轉</label>
              <input
                value={String(el.rotation ?? 0)}
                onChange={(e) => {
                  const r = Number(e.target.value);
                  if (![0, 90, 180, 270].includes(r)) return;
                  props.onUpdateElement(el.id, { rotation: r });
                }}
              />
            </div>

            <div className="btnRow" style={{ marginTop: 10 }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  const cur = Number(el.rotation ?? 0);
                  const next = (cur + 90) % 360;
                  props.onUpdateElement(el.id, { rotation: next });
                }}
              >
                旋轉 90°
              </button>

              {props.onSetLoad ? (
                <button className="btn secondary" type="button" onClick={() => props.onSetLoad?.(el.id)}>
                  設為負載 ZL
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="note" style={{ marginTop: 10 }}>
            接地（GND）是參考點（0V）。
          </div>
        )}

        <div className="btnRow" style={{ marginTop: 14 }}>
          <button className="btn danger" onClick={props.onDeleteSelected}>
            刪除
          </button>
        </div>
      </div>
    );
  };

  // --- 解題過程（solveSteps/debugCx） ---
  const renderSolveSteps = () => {
    if (!solution?.ok) return null;

    const steps = solution.solveSteps as any[] | undefined;
    const dbg = solution.debugCx as any | undefined;

    if (!steps?.length) return null;

    return (
      <div style={{ marginTop: 14 }}>
        <div className="hr" />
        <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>
          解題過程（嚴謹型：MNA / KCL / KVL）
        </div>

        {steps.map((s, idx) => (
          <details key={idx} style={{ marginBottom: 10 }} open={idx === steps.length - 1}>
            <summary style={{ cursor: "pointer", color: "#e6eefc" }}>{s.title}</summary>
            {s.note ? <div className="note" style={{ marginTop: 6 }}>{s.note}</div> : null}
            <div className="note mono" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
              {s.lines?.join("\n")}
            </div>
          </details>
        ))}

        {dbg ? (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", color: "#e6eefc" }}>Debug｜矩陣 A、向量 z、解 x（可複製）</summary>
            <div className="note mono" style={{ marginTop: 8, whiteSpace: "pre-wrap" }}>
{`unknowns:
${dbg.unknownOrder.join(", ")}

z:
${dbg.z.join("\n")}

x:
${dbg.x.join("\n")}

A:
${dbg.A.map((row: string[]) => row.join(" , ")).join("\n")}`}
            </div>
          </details>
        ) : null}
      </div>
    );
  };

  // --- 端口分析：Vth/Zth/ZLopt/Pmax ---
  const renderPort = () => {
    if (!measure.a && !measure.b) return null;

    const A = measure.a ?? "";
    const B = measure.b ?? "";

    return (
      <div style={{ marginTop: 12 }}>
        <div className="hr" />
        <div className="note" style={{ fontWeight: 700, marginBottom: 6 }}>
          端口分析（Thevenin / Norton / 最大功率）
        </div>

        <div className="note">
          端口：A=<span className="mono">{A || "未選"}</span>，B=<span className="mono">{B || "未選"}</span>
        </div>

        <div className="note">
          負載 ZL：{" "}
          {loadElementId ? (
            <>
              <span className="mono">{loadElementId}</span>（計算 Vth/Zth 時會暫時移除）
              {props.onClearLoad ? (
                <button className="btn secondary" style={{ marginLeft: 8 }} onClick={props.onClearLoad} type="button">
                  清除負載
                </button>
              ) : null}
            </>
          ) : (
            <>未指定</>
          )}
        </div>

        <div className="btnRow" style={{ marginTop: 10 }}>
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (!builtNet || !solution?.ok || !measure.a || !measure.b) {
                setPortReport("⚠️ 需要先求解，並用量測工具選好 A/B 兩點。");
                return;
              }

              // 1) baseNet：可選移除 ZL
              const baseNet = {
                ...builtNet,
                elements: (builtNet.elements ?? []).filter((e: any) => (loadElementId ? e.id !== loadElementId : true)),
              };

              // 2) Vth：開路（移除 ZL）後再解一次
              const resV = solveMNA(baseNet, freqHz);
              if (!resV.ok) {
                setPortReport(`Vth 求解失敗：${resV.error ?? ""}`);
                return;
              }
              const Va = (resV.nodeVoltages?.[measure.a] ?? cx(0, 0)) as any as Cx;
              const Vb = (resV.nodeVoltages?.[measure.b] ?? cx(0, 0)) as any as Cx;
              const Vth = sub(Va, Vb);

              // 3) Zth：關源 + 測試源
              const offNet = {
                ...baseNet,
                elements: (baseNet.elements ?? []).map((e: any) => {
                  if (e.type === "V") return { ...e, value: "0" };
                  if (e.type === "I") return { ...e, value: "0" };
                  return e;
                }),
              };

              // ✅ 修正方向：把測試電流源端點對調，讓 Vab=Va−Vb 與 Itest 方向一致
              //    也就是：I_TEST 的 a = B, b = A
              const offNet2 = {
                ...offNet,
                elements: [
                  ...(offNet.elements ?? []),
                  { id: "I_TEST", type: "I", name: "I_TEST", a: measure.b, b: measure.a, value: "1" }, // ✅ 這行就是你要的改法
                ],
              };

              const resZ = solveMNA(offNet2, freqHz);
              if (!resZ.ok) {
                setPortReport(`Zth 求解失敗：${resZ.error ?? ""}`);
                return;
              }

              const Va2 = (resZ.nodeVoltages?.[measure.a] ?? cx(0, 0)) as any as Cx;
              const Vb2 = (resZ.nodeVoltages?.[measure.b] ?? cx(0, 0)) as any as Cx;
              const Vtest = sub(Va2, Vb2); // Vab_test

              // Itest 在「端口 A→B」的定義下仍為 +1A（我們已用 b→a 方式塞進 solver 修正符號）
              const Zth = Vtest; // /1A

              const ZLopt = conj(Zth);
              const Rth = Zth.re;

              let Pmax = NaN;
              if (Rth > 0) Pmax = (abs(Vth) ** 2) / (4 * Rth);
              const PmaxPeak = Number.isFinite(Pmax) ? Pmax / 2 : NaN;

              const lines: string[] = [];
              lines.push("【Step 0｜端口定義】");
              lines.push(`A=${measure.a}, B=${measure.b}`);
              if (loadElementId) lines.push(`（已暫時移除負載元件：${loadElementId}）`);
              lines.push("");

              lines.push("【Step 1｜Vth（開路端電壓）】");
              lines.push(`Va = ${fmtCx(Va)} V`);
              lines.push(`Vb = ${fmtCx(Vb)} V`);
              lines.push(`Vth = Va − Vb = ${fmtCx(Vth)} V`);
              lines.push("");

              lines.push("【Step 2｜Zth（關源 + 測試源法）】");
              lines.push("關掉獨立源：獨立電壓源 V→0（短路）、獨立電流源 I→0（開路）");
              lines.push("加入測試電流源：I_TEST 設為 b→a = 1A（用來對齊 solver 的方向慣例）");
              lines.push(`Va_test = ${fmtCx(Va2)} V`);
              lines.push(`Vb_test = ${fmtCx(Vb2)} V`);
              lines.push(`Vab_test = Va_test − Vb_test = ${fmtCx(Vtest)} V`);
              lines.push(`Zth = Vab_test / 1A = ${fmtCx(Zth)} Ω`);
              lines.push("");

              lines.push("【Step 3｜Norton 等效】");
              const In = div(Vth, Zth);
              lines.push(`In = Vth / Zth = ${fmtCx(Vth)} / ${fmtCx(Zth)} = ${fmtCx(In)} A`);
              lines.push("");

              lines.push("【Step 4｜最大平均功率傳輸（AC）】");
              lines.push(`ZL_opt = conj(Zth) = ${fmtCx(ZLopt)} Ω`);
              lines.push(`Re(Zth) = ${fmtNum(Rth)}`);
              lines.push("Pmax(RMS) = |Vth|^2 / (4·Re(Zth))");
              if (Number.isFinite(Pmax)) {
                lines.push(`|Vth| = ${fmtNum(abs(Vth))}`);
                lines.push(`Pmax(RMS) = ${fmtNum(Pmax)} W`);
                lines.push(`Pmax(Peak-convention) = Pmax/2 = ${fmtNum(PmaxPeak)} W`);
              } else {
                lines.push("⚠️ Re(Zth) ≤ 0，無法使用最大功率公式（或端口不是被動可實現）。");
              }

              setPortReport(lines.join("\n"));
            }}
          >
            計算 Vth / Zth / ZLopt / Pmax
          </button>

          {props.onClearMeasure ? (
            <button className="btn secondary" type="button" onClick={props.onClearMeasure}>
              清除 A/B
            </button>
          ) : null}
        </div>

        {portReport ? (
          <pre className="note mono" style={{ marginTop: 10, whiteSpace: "pre-wrap" }}>
            {portReport}
          </pre>
        ) : null}
      </div>
    );
  };

  return (
    <div>
      {current.kind === "none" ? <div className="note">先切到「選取」，或用「量測/端口」工具點 A/B。</div> : null}

      {renderElementEditor()}
      {renderPort()}
      {renderSolveSteps()}

      <div className="hr" />
      <div className="note">
        <div style={{ fontWeight: 700, marginBottom: 6 }}>提示</div>
        <div>• 端口分析：要先求解，並點在節點圈圈附近</div>
        <div>• 若端口間已有負載，建議先把該元件「設為負載 ZL」</div>
      </div>
    </div>
  );
}