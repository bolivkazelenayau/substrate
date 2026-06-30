import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

const sourceFiles = ["src/**/*.{ts,tsx}", "tests/**/*.ts"];

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**", "vite.config.{js,d.ts}"] },
  {
    files: sourceFiles,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    files: ["src/engine/exportSvg.ts"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["../components/Canvas*", "./preview*", "./gpu/**", "../experiments/**"], message: "SVG export must remain isolated from preview, WebGPU, and experiments." },
        ],
      }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/experiments/**"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          { group: ["**/experiments/**"], message: "Experiments require an explicit dev-only adapter; production runtime cannot import them directly." },
        ],
      }],
    },
  },
];
