import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([".envio/**", "envio-env.d.ts"]),
  tseslint.configs.recommended,
]);
