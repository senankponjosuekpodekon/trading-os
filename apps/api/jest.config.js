module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // Seuils anti-régression (cible TODO.md : branches 70 / functions 80 / lines 80).
  // Relevés progressivement à mesure que la couverture augmente.
  coverageThreshold: {
    global: {
      statements: 40,
      branches: 35,
      functions: 30,
      lines: 40,
    },
  },
};
