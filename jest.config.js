// jest.config.js
const nextJest = require('next/jest')

// Next.js 앱의 경로를 제공하여 설정 로드
const createJestConfig = nextJest({
  dir: './',
})

// Jest의 커스텀 설정 정의
const customJestConfig = {
  // 테스트 환경 정의 (API 테스트이므로 node 환경이 적합합니다)
  testEnvironment: 'node',
  // 절대 경로 매핑 (@/*)을 Jest가 이해할 수 있도록 설정
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
}

module.exports = createJestConfig(customJestConfig)