export type ElementType = "R" | "C" | "L" | "V" | "I" | "GND";
export type Point = { x: number; y: number };

export type Tool =
  | "select"
  | "pan"
  | "place_R"
  | "place_C"
  | "place_L"
  | "place_V"
  | "place_I"
  | "place_GND"
  | "wire"
  | "junction"
  | "measure_V"; // ✅ NEW

export type Element2T = {
  id: string;
  type: "R" | "C" | "L" | "V" | "I";
  name: string;
  a: Point;
  b: Point;
  value: string;
  rotation: 0 | 90 | 180 | 270;
  x: number;
  y: number;
};

export type Ground = {
  id: string;
  type: "GND";
  name: string;
  p: Point;
  x: number;
  y: number;
};

export type Element = Element2T | Ground;

export type Wire = { id: string; points: Point[] };
export type Junction = { id: string; p: Point };

export type CircuitDoc = {
  version: 1;
  grid: number;
  freqHz: number;
  elements: Element[];
  wires: Wire[];
  junctions: Junction[];
};

export type CircuitNet = {
  nodes: { id: string; p: Point }[];
  hasGround: boolean;
  elements: {
    id: string;
    type: "R" | "C" | "L" | "V" | "I" | "GND";
    name: string;
    a?: string;
    b?: string;
    value?: string;
  }[];
};

export type SolveResult = {
  ok: boolean;
  error?: string;

  nodeVoltages?: Record<string, { re: number; im: number }>;
  elementVoltages?: Record<string, { re: number; im: number }>;
  elementCurrents?: Record<string, { re: number; im: number }>;
  elementPowers?: Record<string, { re: number; im: number }>;

  solveSteps?: {
    kind: string;
    title: string;
    note?: string;
    lines: string[];
  }[];

  debugCx?: {
    nodeOrder: string[];
    vsrcOrder: string[];
    unknownOrder: string[];
    A: string[][];
    z: string[];
    x: string[];
  };
};