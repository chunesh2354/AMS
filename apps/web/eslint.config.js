import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const COLOUR = '/#[0-9a-fA-F]{3,8}\\b|\\brgba?\\(|\\bhsla?\\(/';

export default tseslint.config(
  { ignores: ['dist', 'storybook-static', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mjs,js}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Section 12.3: no colour literal anywhere outside tokens.css.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${COLOUR}]`, message: 'Colour literals are only allowed in ui/tokens.css.' },
        { selector: `TemplateElement[value.raw=${COLOUR}]`, message: 'Colour literals are only allowed in ui/tokens.css.' },
      ],
    },
  },
);
