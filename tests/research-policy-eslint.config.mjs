export default [{
  files: ['**/*.cjs'],
  languageOptions: {globals: {require: 'readonly', module: 'readonly'}},
  rules: {
    'no-undef': 'error', 'no-unused-vars': 'error', 'no-unreachable': 'error',
    complexity: ['error', 10], 'max-depth': ['error', 3],
    'max-params': ['error', 4], 'max-lines': ['error', 400],
    'max-lines-per-function': ['error', {max: 40, skipBlankLines: true, skipComments: true}]
  }
}];
