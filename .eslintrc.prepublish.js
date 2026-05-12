/**
 * Stricter ESLint config applied before npm publish.
 * Promotes verification-blocking rules from warn → error.
 */
module.exports = {
	extends: './.eslintrc.js',

	overrides: [
		{
			files: ['package.json'],
			plugins: ['eslint-plugin-n8n-nodes-base'],
			rules: {
				'n8n-nodes-base/community-package-json-name-still-default': 'error',
			},
		},
	],
};
