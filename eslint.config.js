import globals from 'globals';

const browserFiles = [
  'code/frontend/**/*.js',
  'docs/software/prototype/*.js',
  'docs/software/walkthrough/*.js'
];

export default [
  {
    files: ['code/**/*.js', ...browserFiles, 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    rules: {
      'no-constant-condition': 'error',
      'no-dupe-keys': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unsafe-finally': 'error',
      'valid-typeof': 'error',
      'no-unused-vars': 'warn',
      complexity: ['warn', { max: 10 }]
    }
  },
  {
    files: ['code/backend/**/*.js', 'tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: { globals: globals.nodeBuiltin }
  },
  {
    files: browserFiles,
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['docs/software/walkthrough/*.js'],
    languageOptions: { sourceType: 'script' }
  }
];
