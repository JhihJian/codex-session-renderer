{
  const { cleanPatchPath } = globalThis.ToolSummaryInternals?.text || {};
  if (!cleanPatchPath) throw new Error("ToolSummary text helpers must load before patch helpers.");

  function extractPatchFiles(argumentsText, outputText) {
    const files = [];
    const text = [argumentsText, outputText].filter(Boolean).join("\n");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(?:[AMDR]\s+|[-+]{3}\s+[ab]\/|\+\+\+\s+[ab]\/)(.+)$/);
      if (match) files.push(match[1].trim());
    }
    return [...new Set(files)].slice(0, 4).join(", ");
  }

  function extractChangeSet(argumentsText, outputText, toolName) {
    const patch = parseApplyPatch(argumentsText);
    const outputFiles = parsePatchOutputFiles(outputText);
    const files = mergePatchFiles(patch.files, outputFiles);
    const additions = files.reduce((total, file) => total + (Number(file.additions) || 0), 0);
    const deletions = files.reduce((total, file) => total + (Number(file.deletions) || 0), 0);
    const hunkCount = files.reduce((total, file) => total + (Number(file.hunks) || 0), 0);
    const source = patch.files.length ? "patch" : outputFiles.length ? "output" : /apply_patch/i.test(toolName || "") ? "apply_patch" : "";
    return {
      kind: source ? "file-diff" : "",
      source,
      files,
      fileCount: files.length,
      additions,
      deletions,
      hunkCount,
    };
  }

  function parseApplyPatch(text) {
    const files = [];
    const lines = String(text || "").split(/\r?\n/);
    let current = null;

    const finish = () => {
      if (!current) return;
      const normalized = normalizePatchFile(current);
      if (normalized.path) files.push(normalized);
      current = null;
    };

    for (const line of lines) {
      let match = line.match(/^\*\*\* Add File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "added");
        continue;
      }
      match = line.match(/^\*\*\* Delete File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "deleted");
        continue;
      }
      match = line.match(/^\*\*\* Update File:\s+(.+)$/);
      if (match) {
        finish();
        current = newPatchFile(match[1], "modified");
        continue;
      }
      match = line.match(/^\*\*\* Move to:\s+(.+)$/);
      if (match && current) {
        current.oldPath = current.path;
        current.path = match[1];
        current.status = "renamed";
        continue;
      }
      if (!current) continue;
      if (/^@@/.test(line)) {
        current.hunks += 1;
        continue;
      }
      if (/^\+(?!\+\+)/.test(line)) {
        current.additions += 1;
        continue;
      }
      if (/^-(?!--)/.test(line)) current.deletions += 1;
    }
    finish();
    return { files };
  }

  function newPatchFile(path, status) {
    return {
      path: cleanPatchPath(path),
      oldPath: "",
      status,
      additions: 0,
      deletions: 0,
      hunks: 0,
    };
  }

  function parsePatchOutputFiles(outputText) {
    const files = [];
    for (const line of String(outputText || "").split(/\r?\n/)) {
      const match = line.trim().match(/^([AMD])\s+(.+)$/);
      if (!match) continue;
      files.push(newPatchFile(match[2], patchStatusFromShort(match[1])));
    }
    return files;
  }

  function mergePatchFiles(primary, secondary) {
    const byPath = new Map();
    for (const file of [...primary, ...secondary]) {
      const normalized = normalizePatchFile(file);
      if (!normalized.path) continue;
      const key = [normalized.oldPath, normalized.path].join("\0");
      const existing = byPath.get(key);
      if (!existing) {
        byPath.set(key, normalized);
        continue;
      }
      existing.status = existing.status || normalized.status;
      existing.additions = Math.max(existing.additions || 0, normalized.additions || 0);
      existing.deletions = Math.max(existing.deletions || 0, normalized.deletions || 0);
      existing.hunks = Math.max(existing.hunks || 0, normalized.hunks || 0);
      existing.changeCount = existing.additions + existing.deletions;
    }
    return [...byPath.values()];
  }

  function normalizePatchFile(file) {
    const additions = Math.max(0, Number(file?.additions) || 0);
    const deletions = Math.max(0, Number(file?.deletions) || 0);
    return {
      path: cleanPatchPath(file?.path),
      oldPath: cleanPatchPath(file?.oldPath || ""),
      status: file?.status || "modified",
      additions,
      deletions,
      hunks: Math.max(0, Number(file?.hunks) || 0),
      changeCount: additions + deletions,
    };
  }

  function patchStatusFromShort(value) {
    if (value === "A") return "added";
    if (value === "D") return "deleted";
    return "modified";
  }

  function displayPatchFilePath(file) {
    if (!file) return "";
    const path = file.path || "";
    return file.oldPath && file.oldPath !== path ? `${file.oldPath} -> ${path}` : path;
  }

  function formatPatchSummary(changeSet) {
    const files = changeSet?.files || [];
    if (!files.length) return "";
    const fileLabel = `${files.length} 个文件`;
    const stats = changeSet.additions || changeSet.deletions ? `+${changeSet.additions || 0} -${changeSet.deletions || 0}` : "";
    const shown = files.slice(0, 3).map(displayPatchFilePath).filter(Boolean);
    const more = files.length > shown.length ? `+${files.length - shown.length}` : "";
    return [fileLabel, stats, [...shown, more].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  }

  function patchBodyModel(value, changeSet = null) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    let lines = raw.split(/\r?\n/);
    let command = "apply_patch";
    if (/^\s*apply_patch\s*$/i.test(lines[0] || "")) {
      command = lines.shift().trim();
    }
    const beginIndex = lines.findIndex((line) => line.trim() === "*** Begin Patch");
    const firstFileIndex = lines.findIndex((line) => /^\*\*\*\s+(?:Add|Update|Delete)\s+File:\s+/.test(line));
    if (beginIndex < 0 && firstFileIndex < 0) return null;
    lines = lines.slice(beginIndex >= 0 ? beginIndex + 1 : firstFileIndex);
    const endIndex = lines.findIndex((line) => line.trim() === "*** End Patch");
    if (endIndex >= 0) lines = lines.slice(0, endIndex);

    const files = [];
    let current = null;
    const finish = () => {
      if (!current) return;
      const normalized = normalizePatchFile(current);
      const stats = patchStatsForFile(normalized, changeSet);
      files.push({
        ...normalized,
        additions: Math.max(normalized.additions, stats?.additions || 0),
        deletions: Math.max(normalized.deletions, stats?.deletions || 0),
        hunks: Math.max(normalized.hunks, stats?.hunks || 0),
        lines: current.lines,
      });
      current = null;
    };

    for (const line of lines) {
      let match = line.match(/^\*\*\* Add File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "added");
        continue;
      }
      match = line.match(/^\*\*\* Delete File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "deleted");
        continue;
      }
      match = line.match(/^\*\*\* Update File:\s+(.+)$/);
      if (match) {
        finish();
        current = patchBodyFile(match[1], "modified");
        continue;
      }
      match = line.match(/^\*\*\* Move to:\s+(.+)$/);
      if (match && current) {
        current.oldPath = current.path;
        current.path = cleanPatchPath(match[1]);
        current.status = "renamed";
        continue;
      }
      if (!current) continue;
      if (/^@@/.test(line)) {
        current.hunks += 1;
        current.lines.push({ kind: "hunk", marker: "@@", text: line });
        continue;
      }
      if (/^\+(?!\+\+)/.test(line)) {
        current.additions += 1;
        current.lines.push({ kind: "added", marker: "+", text: line.slice(1) });
        continue;
      }
      if (/^-(?!--)/.test(line)) {
        current.deletions += 1;
        current.lines.push({ kind: "removed", marker: "-", text: line.slice(1) });
        continue;
      }
      if (/^\*\*\*/.test(line)) continue;
      current.lines.push({ kind: "context", marker: " ", text: line.startsWith(" ") ? line.slice(1) : line });
    }
    finish();
    if (!files.length) return null;
    const normalizedFiles = files.map((file) => ({
      ...file,
      changeCount: (Number(file.additions) || 0) + (Number(file.deletions) || 0),
    }));
    return {
      kind: "apply_patch",
      command,
      files: normalizedFiles,
      fileCount: normalizedFiles.length,
      additions: normalizedFiles.reduce((total, file) => total + (Number(file.additions) || 0), 0),
      deletions: normalizedFiles.reduce((total, file) => total + (Number(file.deletions) || 0), 0),
      hunkCount: normalizedFiles.reduce((total, file) => total + (Number(file.hunks) || 0), 0),
    };
  }

  function patchBodyFile(path, status) {
    return {
      ...newPatchFile(path, status),
      lines: [],
    };
  }

  function patchStatsForFile(file, changeSet) {
    const files = changeSet?.files || [];
    return files.find((entry) => cleanPatchPath(entry.path) === file.path && cleanPatchPath(entry.oldPath || "") === file.oldPath) || files.find((entry) => cleanPatchPath(entry.path) === file.path) || null;
  }

  const parts = globalThis.ToolSummaryInternals || (globalThis.ToolSummaryInternals = {});
  parts.patch = {
    extractChangeSet,
    extractPatchFiles,
    formatPatchSummary,
    patchBodyModel,
    displayPatchFilePath,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = parts.patch;
}
