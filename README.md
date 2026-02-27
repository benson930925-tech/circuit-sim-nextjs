# Circuit Sim (Next.js + Konva) — MVP

這是一個可拖拉、可接線的 DC 電路模擬器 MVP：
- 元件：R / 獨立電壓源 V / 獨立電流源 I / GND
- 互動：拖曳元件、正交 L 型走線、Junction 節點點、Delete 刪除
- 求解：Modified Nodal Analysis (MNA) + 高斯消去（純前端）
- 顯示：節點電壓、元件電流（a→b）

## 快速開始

```bash
npm install
npm run dev
```

打開瀏覽器： http://localhost:3000/editor

## 操作
- Pan：按住 Space 拖曳
- Zoom：Ctrl + 滾輪
- Wire：切到 Wire，點起點，再點終點（預設 L 型）
- 交叉要真的連接：請放 Junction

## 重要定義
- V 元件：定義為 Va − Vb = value
- I 元件：方向 a → b，數值為 value（A）
- Solver 輸出電流：I(a→b)

## 之後擴充方向
- 受控源（VCVS/VCCS/CCVS/CCCS）
- AC 相量（複數阻抗）與掃頻
- RC/RL/RLC 暫態（Backward Euler/Trapezoidal）


## 新增功能（v2）
- 旋轉按鈕：屬性面板可一鍵旋轉 90°
- 元件新增：電容 C / 電感 L
- 複數相量：元件與電源數值可輸入複數（如 1+2i、10m i 等），並支援頻率（Hz）進行 AC 解析。
