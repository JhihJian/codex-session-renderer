import { createServer } from "node:http";
import { createSnapshotShareHandler, snapshotShareConfig } from "./src/snapshot-share.mjs";

const config = snapshotShareConfig();

if (!config.token) {
  console.error("缺少 CODEX_SHARE_TOKEN。为避免会话数据裸露，快照共享服务不会在无 token 时启动。");
  process.exitCode = 1;
} else {
  createServer(createSnapshotShareHandler({ config })).listen(config.port, config.host, () => {
    console.log(`Codex session snapshot share: http://${config.host}:${config.port}/api/codex-snapshot.tar`);
    console.log(`Codex Home: ${config.codexHome}`);
    console.log("Authorization: Bearer <CODEX_SHARE_TOKEN>");
  });
}
