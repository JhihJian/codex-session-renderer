import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditChain, isDangerousCommand, isVerificationText } from "../src/audit-chain.mjs";

test("buildAuditChain links intent, action, evidence, verification and final nodes", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        status: "completed",
        items: [
          {
            id: "item-0",
            type: "user-message",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 1,
            timestamp: "2026-06-26T10:00:01.000Z",
            text: "请修复测试",
          },
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 1,
            sourceIndex: 2,
            outputSourceIndex: 3,
            timestamp: "2026-06-26T10:00:02.000Z",
            completedAt: "2026-06-26T10:00:03.000Z",
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "npm test",
            output: "ok 1 - passes",
          },
          {
            id: "item-2",
            type: "assistant-message",
            turnIndex: 0,
            itemIndex: 2,
            sourceIndex: 4,
            timestamp: "2026-06-26T10:00:04.000Z",
            phase: "final",
            text: "已修复并测试通过。",
          },
        ],
      },
    ],
  });

  assert.deepEqual(
    chain.nodes.map((node) => node.type),
    ["intent", "action", "evidence", "verification", "final"],
  );
  assert.equal(chain.counts.verification, 1);
  assert.equal(chain.counts.risk, 0);
  assert.equal(chain.nodes.find((node) => node.type === "evidence").eventIndex, 3);
});

test("buildAuditChain emits high risk for dangerous command and missing output", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 5,
            name: "exec_command",
            callId: "call-1",
            status: "started",
            arguments: "git reset --hard && Remove-Item -Recurse tmp",
            output: null,
          },
        ],
      },
    ],
  });

  const risks = chain.nodes.filter((node) => node.type === "risk");
  assert.equal(risks.length, 1);
  assert.equal(risks[0].riskLevel, "high");
  assert.match(risks[0].summary, /危险命令|没有对应输出/);
  assert.equal(isDangerousCommand("git clean -fd"), true);
});

test("dangerous command detection does not flag ordinary format scripts or searches", () => {
  assert.equal(isDangerousCommand("npm run format"), false);
  assert.equal(isDangerousCommand("rg format public/app.js"), false);
  assert.equal(isDangerousCommand('rg -n "Remove-Item|git clean|format" src test'), false);
  assert.equal(isDangerousCommand('grep -R "git clean" .'), false);
  assert.equal(isDangerousCommand('findstr /S /I "Remove-Item" *.mjs'), false);
  assert.equal(isDangerousCommand("Get-ChildItem test | Format-Table Name"), false);
  assert.equal(isDangerousCommand("Get-ChildItem test | Format-List Name"), false);
  assert.equal(isDangerousCommand("format C:"), true);
  assert.equal(isDangerousCommand("Format-Volume -DriveLetter E"), true);
});

test("buildAuditChain does not treat search text or display formatting as high-risk commands", () => {
  const commands = [
    'rg -n "Remove-Item|git clean|format" src test',
    "Get-ChildItem test | Format-Table Name",
    "{\"cmd\":\"rg -n \\\"Remove-Item|git clean\\\" src\"}",
    "{\"cmd\":\"Get-ChildItem test | Format-List Name\"}",
  ];

  for (const [index, command] of commands.entries()) {
    const chain = buildAuditChain({
      turns: [
        {
          id: `turn-${index}`,
          turnNumber: 1,
          startedAt: "2026-06-26T10:00:00.000Z",
          items: [
            {
              id: `call-${index}`,
              type: "tool-call",
              turnIndex: 0,
              itemIndex: 0,
              sourceIndex: index + 20,
              outputSourceIndex: index + 40,
              name: "exec_command",
              callId: `call-${index}`,
              status: "completed",
              arguments: command,
              output: "ok",
            },
          ],
        },
      ],
    });

    const risks = chain.nodes.filter((node) => node.type === "risk");
    assert.equal(risks.some((node) => node.tags.includes("dangerous-command")), false, command);
    assert.equal(risks.some((node) => node.riskLevel === "high"), false, command);
  }
});

test("patch text with dangerous words is not treated as an executed high-risk command", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 4,
            outputSourceIndex: 5,
            name: "apply_patch",
            callId: "call-1",
            status: "completed",
            arguments: "*** Begin Patch\n+Remove-Item -Recurse tmp\n+git clean -fd\n+format C:\n*** End Patch",
            output: "Success. Updated the following files:\nM test/audit-chain.test.mjs",
          },
        ],
      },
    ],
  });

  const risks = chain.nodes.filter((node) => node.type === "risk");
  assert.equal(risks.length, 1);
  assert.equal(risks[0].riskLevel, "low");
  assert.equal(risks[0].tags.includes("dangerous-text"), true);
  assert.equal(risks[0].tags.includes("dangerous-command"), false);
  assert.doesNotMatch(risks[0].summary, /执行/);
});

test("buildAuditChain flags final verification claim without verification evidence", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "item-0",
            type: "assistant-message",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 8,
            timestamp: "2026-06-26T10:00:01.000Z",
            phase: "final",
            text: "完成，已修复。",
          },
        ],
      },
    ],
  });

  const risk = chain.nodes.find((node) => node.type === "risk");
  const final = chain.nodes.find((node) => node.type === "final");
  assert.equal(risk?.riskLevel, "medium");
  assert.equal(risk?.tags.includes("missing-verification"), true);
  assert.equal(final?.riskLevel, "medium");
  assert.equal(isVerificationText("npm run check"), true);
});

test("buildAuditChain does not classify ordinary goal tools as verification from output claims", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "get_goal",
            callId: "call-1",
            status: "completed",
            arguments: "{}",
            output: "完成目标：修复 Audit 视图。",
          },
          {
            id: "call-2",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 1,
            sourceIndex: 4,
            outputSourceIndex: 5,
            name: "create_goal",
            callId: "call-2",
            status: "completed",
            arguments: "{\"objective\":\"检查完成目标\"}",
            output: "目标已创建。",
          },
        ],
      },
    ],
  });

  assert.equal(chain.counts.verification, 0);
  assert.equal(isVerificationText("完成目标"), false);
  assert.equal(isVerificationText("npm run build"), true);
});

test("buildAuditChain requires explicit verification command for generic exec output", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "git status --short",
            output: "tests passed in previous run",
          },
        ],
      },
    ],
  });

  assert.equal(chain.counts.verification, 0);
});

test("buildAuditChain does not classify reading or searching test files as verification", () => {
  const falsePositiveCommands = [
    "Get-ChildItem -File test | Select-Object -ExpandProperty Name",
    "ls test",
    "rg test",
    "cat test/audit-chain.test.mjs",
  ];

  for (const [index, command] of falsePositiveCommands.entries()) {
    const chain = buildAuditChain({
      turns: [
        {
          id: `turn-${index}`,
          turnNumber: 1,
          startedAt: "2026-06-26T10:00:00.000Z",
          items: [
            {
              id: `call-${index}`,
              type: "tool-call",
              turnIndex: 0,
              itemIndex: 0,
              sourceIndex: index * 2,
              outputSourceIndex: index * 2 + 1,
              name: "exec_command",
              callId: `call-${index}`,
              status: "completed",
              arguments: command,
              output: "test/audit-chain.test.mjs",
            },
          ],
        },
      ],
    });

    assert.equal(chain.counts.verification, 0, command);
    assert.equal(isVerificationText(command), false, command);
  }
});

test("isVerificationText recognizes explicit verification commands", () => {
  const commands = [
    "npm test",
    "npm run check",
    "node --test",
    "pytest",
    "playwright test",
    "npm run build",
    "npx tsc --noEmit",
    "curl http://localhost:3000/health",
  ];

  for (const command of commands) {
    assert.equal(isVerificationText(command), true, command);
  }
});

test("buildAuditChain treats HTTP health checks as verification", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "curl http://localhost:3000/health",
            output: "{\"status\":\"ok\"}",
          },
        ],
      },
    ],
  });

  assert.equal(chain.counts.verification, 1);
});

test("successful verification output with zero failures does not emit risk", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "node --test",
            output: "# tests 45\n# pass 45\n# fail 0\n# errors 0",
          },
        ],
      },
    ],
  });

  assert.equal(chain.counts.verification, 1);
  assert.equal(chain.counts.risk, 0);
});

test("truncated tool items do not emit audit gap nodes", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "node scripts/report.mjs",
            output: "large report preview",
            truncated: true,
            truncatedFields: ["output"],
          },
        ],
      },
    ],
  });

  const gapNodes = chain.nodes.filter((node) => node.title === "需 Raw 复核" || node.status === "needs-raw");
  assert.equal(chain.counts.risk, 0);
  assert.equal(gapNodes.length, 0);
  assert.equal(chain.nodes.some((node) => node.type === "incomplete"), false);
});

test("audit nodes keep compact summaries and full review bodies", () => {
  const longIntent = `请完整复核 ${"用户目标 ".repeat(80)}`.trim();
  const longOutput = `line-0\n${Array.from({ length: 120 }, (_, index) => `line-${index + 1} ${Array.from({ length: 8 }, () => "output").join(" ")}`).join("\n")}`;
  const longFinal = `最终结论：${"已经完成详细说明 ".repeat(80)}`.trim();
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "item-0",
            type: "user-message",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 1,
            text: longIntent,
          },
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 1,
            sourceIndex: 2,
            outputSourceIndex: 3,
            name: "exec_command",
            callId: "call-1",
            status: "completed",
            arguments: "node scripts/report.mjs",
            output: longOutput,
          },
          {
            id: "item-2",
            type: "assistant-message",
            turnIndex: 0,
            itemIndex: 2,
            sourceIndex: 4,
            phase: "final",
            text: longFinal,
          },
        ],
      },
    ],
  });

  const intent = chain.nodes.find((node) => node.type === "intent");
  const evidence = chain.nodes.find((node) => node.type === "evidence");
  const final = chain.nodes.find((node) => node.type === "final");

  assert.equal(intent.body, longIntent);
  assert.equal(evidence.body, longOutput);
  assert.equal(evidence.outputBody, longOutput);
  assert.equal(final.body, longFinal);
  assert.ok(intent.summary.length < intent.body.length);
  assert.ok(evidence.summary.length < evidence.body.length);
  assert.ok(final.summary.length < final.body.length);
});

test("risk nodes expose related source metadata", () => {
  const chain = buildAuditChain({
    turns: [
      {
        id: "turn-1",
        turnNumber: 1,
        startedAt: "2026-06-26T10:00:00.000Z",
        items: [
          {
            id: "call-1",
            type: "tool-call",
            turnIndex: 0,
            itemIndex: 0,
            sourceIndex: 7,
            name: "exec_command",
            callId: "call-1",
            status: "started",
            arguments: "Remove-Item -Recurse tmp",
            output: null,
          },
        ],
      },
    ],
  });

  const action = chain.nodes.find((node) => node.type === "action");
  const risk = chain.nodes.find((node) => node.type === "risk");
  assert.equal(risk?.relatedNodeId, action?.id);
  assert.equal(risk?.relatedType, "action");
  assert.equal(risk?.toolName, "exec_command");
  assert.equal(risk?.eventIndex, 7);
});
