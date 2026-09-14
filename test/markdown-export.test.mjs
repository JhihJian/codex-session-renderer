import test from "node:test";
import assert from "node:assert/strict";
import { markdownItemTitle, renderConversationMarkdown } from "../src/markdown-export.mjs";

test("markdown export uses localized fallback titles", () => {
  const markdown = renderConversationMarkdown(
    { id: "thread-1", title: "" },
    [
      {
        id: "turn-1",
        items: [
          { type: "tool-call", arguments: "{}" },
          { type: "token-count", info: { total_token_usage: { total_tokens: 1024 } } },
        ],
      },
    ],
  );

  assert.match(markdown, /^# 未命名会话/m);
  assert.match(markdown, /^## 第 1 轮/m);
  assert.match(markdown, /### 工具调用：未知工具/);
  assert.match(markdown, /### 上下文占用统计/);
  assert.equal(markdownItemTitle({ type: "token-count" }), "上下文占用统计");
});

test("markdown export notes the fork parent when present", () => {
  const markdown = renderConversationMarkdown(
    { id: "child-1", title: "分叉会话", parentSessionId: "01a09d90-a529-7352-b1b1-155c3abd07a5" },
    [],
  );
  assert.match(markdown, /- 分叉自会话: `01a09d90-a529-7352-b1b1-155c3abd07a5`/);
  const withoutParent = renderConversationMarkdown({ id: "root-1", title: "根会话" }, []);
  assert.doesNotMatch(withoutParent, /分叉自会话/);
});
