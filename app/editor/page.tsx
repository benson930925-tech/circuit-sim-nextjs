import dynamic from "next/dynamic";

const EditorApp = dynamic(() => import("../../components/editor/EditorApp"), { ssr: false });

export default function EditorPage() {
  return <EditorApp />;
}
