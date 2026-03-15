import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['node_modules/**', 'coverage/**'] },
    js.configs.recommended,
    {
        languageOptions: {
            sourceType: 'module',
            globals: {
                ...globals.node
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
        }
    },
    {
        files: ['tests/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.node,
                ...globals.vitest
            }
        }
    }
];
