"use client";

import { useEffect } from "react";
import { boot } from "../src/main";

export default function HomePage() {
  useEffect(() => {
    boot();
  }, []);
  return (
    <div id="app">
      <p className="booting">正在打开试卷…</p>
    </div>
  );
}
