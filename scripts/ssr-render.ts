import { createServer } from "vite";
import React from "react";
import { renderToString } from "react-dom/server";

const server = await createServer({ server: { middlewareMode: true }, logLevel: "error" });
const { App } = await server.ssrLoadModule("/src/app/App.tsx");
const html = renderToString(React.createElement(App));
const mustContain = [
  "保障流程编辑器", // 顶栏按钮 title 不会出现在 html，改用其它锚点
];
console.log("render length:", html.length);
console.log("contains 掌控机坪:", html.includes("掌控机坪"));
console.log("contains 地勤保障:", html.includes("地勤保障"));
console.log("contains 流程编辑:", html.includes("流程编辑"));
for (const token of mustContain) console.log(`contains ${token}:`, html.includes(token));
await server.close();
console.log("SSR 渲染检查完成");
