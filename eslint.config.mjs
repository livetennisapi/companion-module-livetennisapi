import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({})

export default [
	{ ignores: ['pkg/**', 'node_modules/**'] },
	...baseConfig,
	{
		// This module is ESM (Companion module API 2.x); lint every .js file as a module.
		files: ['**/*.js'],
		languageOptions: { sourceType: 'module' },
	},
]
