import Link from "next/link";

export default function Home() {
  return (
    <main style={{maxWidth: 980, margin:"0 auto", padding:"48px 18px"}}>
      <h1 style={{fontSize: 34, margin: "0 0 10px 0"}}>電路模擬器（Konva 版）</h1>
      <p style={{color:"#9fb0d0", lineHeight:1.6, marginTop:0}}>
        可拖拉、可接線的 DC 電路模擬器 MVP：R / 獨立電壓源 / 獨立電流源 / GND，使用 MNA 解線性方程。
      </p>
      <div style={{display:"flex", gap:12, flexWrap:"wrap", marginTop: 18}}>
        <Link href="/editor" style={{
          display:"inline-block",
          background:"#1d4ed8",
          padding:"10px 14px",
          borderRadius:12,
          border:"1px solid #1e3a8a",
          textDecoration:"none"
        }}>進入編輯器</Link>
        <a href="https://github.com/" style={{color:"#9fb0d0"}}>（可自行改成你的 repo）</a>
      </div>

      <div style={{marginTop: 28, padding: 16, border: "1px solid #24304b", borderRadius: 14, background:"rgba(17,26,46,.65)"}}>
        <div style={{fontWeight:700, marginBottom:8}}>快捷操作</div>
        <ul style={{margin:0, paddingLeft: 20, color:"#9fb0d0", lineHeight:1.6}}>
          <li>拖曳元件：直接拖拉</li>
          <li>縮放：Ctrl + 滾輪（或觸控板縮放）</li>
          <li>平移：按住 Space 再拖曳</li>
          <li>接線：切到 Wire，點起點再點終點（正交 L 型走線）</li>
          <li>Junction：切到 Junction，點一下放置節點點（用來讓交叉線真正連接）</li>
          <li>Delete：刪除選取的元件/線/節點</li>
        </ul>
      </div>
    </main>
  );
}
