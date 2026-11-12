module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@nestjs/event-emitter|eventemitter2)/)',
  ],
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
      statements: 55,
      branches: 45,
      functions: 48,
      lines: 55,
    },
  },
};
