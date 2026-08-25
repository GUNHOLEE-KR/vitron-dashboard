import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // ⚠ `.claude/worktrees/` 는 다른 Claude 세션이 만든 «저장소 사본» 이다.
  //   그대로 두면 eslint 가 그 안의 소스까지 훑어, 내 코드가 멀쩡한데도
  //   `npm run lint` 가 실패한다 (2026-08-25 에 92건이 그렇게 떴다).
  //   남의 작업 폴더이므로 지우지 말고 검사에서만 뺀다.
  globalIgnores(['dist', '.claude/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
