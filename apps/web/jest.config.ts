import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jest-environment-jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(lucide-react|@tanstack|axios|clsx|tailwind-merge|zustand|lightweight-charts|jspdf|jspdf-autotable)/)',
  ],
  // Seuils anti-régression (cible TODO.md : branches 70 / functions 80 / lines 80).
  // Relevés progressivement à mesure que la couverture augmente.
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 35,
      functions: 35,
      lines: 60,
    },
  },
};

export default config;
