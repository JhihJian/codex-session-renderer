import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";

const maintainabilityRules = {
  // ESLint 的 bulk suppressions 只基线化 error；这里保持 error，确保新增维护性债务仍会阻断 CI。
  "max-lines": ["error", {
    max: 500,
    skipBlankLines: true,
    skipComments: true,
  }],
  "max-lines-per-function": ["error", {
    max: 100,
    skipBlankLines: true,
    skipComments: true,
    IIFEs: true,
  }],
  complexity: ["error", 15],
  "max-depth": ["error", 4],
  "max-params": ["error", 5],
  "max-statements": ["error", 40],
};

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.next/**",
    "**/.nuxt/**",
    "**/.cache/**",
    "**/.codex-runtime/**",
    "**/generated/**",
    "**/__generated__/**",
    "**/tmp/**",
    "**/temp/**",
    "**/*.min.js",
  ]),
  js.configs.recommended,
  {
    name: "project/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      // 允许通过对象剩余属性显式剔除敏感或大体积字段。
      "no-unused-vars": ["error", { ignoreRestSiblings: true }],
    },
  },
  {
    name: "project/node",
    files: [
      "*.{js,mjs,cjs}",
      "src/**/*.{js,mjs,cjs}",
      "scripts/**/*.{js,mjs,cjs}",
      "test/**/*.{js,mjs,cjs}",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
  },
  {
    name: "project/browser",
    files: ["public/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
    },
  },
  {
    name: "project/browser-test-bridge",
    files: [
      "public/app-format.js",
      "public/tool-summary.js",
    ],
    languageOptions: {
      globals: {
        // 这些无构建浏览器脚本同时通过 CommonJS 分支向 Node 测试暴露纯函数。
        module: "readonly",
      },
    },
  },
  {
    name: "project/maintainability",
    files: ["**/*.{js,mjs,cjs}"],
    rules: maintainabilityRules,
  },
]);
