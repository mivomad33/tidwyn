import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["node_modules/", "data/", ".test-data/", ".claude/worktrees/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
