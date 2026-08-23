import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'ko-KR',
  title: 'AI-Lint',
  description: '레거시 문서가 AI에게 읽히는지 검사하고 고칠 곳을 알려줍니다',

  // GitHub Pages는 https://geniuskey.github.io/AI-Lint/ 로 서빙한다.
  base: '/AI-Lint/',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/AI-Lint/favicon.svg' }],
    ['link', { rel: 'alternate icon', type: 'image/png', href: '/AI-Lint/favicon-32.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/AI-Lint/apple-touch-icon.png' }],
    ['meta', { name: 'theme-color', content: '#3f7ac2' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'AI-Lint' }],
    [
      'meta',
      {
        property: 'og:description',
        content: '레거시 문서가 AI에게 읽히는지 검사하고 고칠 곳을 알려줍니다',
      },
    ],
  ],

  themeConfig: {
    logo: '/favicon.svg',

    nav: [
      { text: '가이드', link: '/guide/', activeMatch: '/guide/' },
      { text: '룰 카탈로그', link: '/rules/', activeMatch: '/rules/' },
      { text: '레퍼런스', link: '/reference/api', activeMatch: '/reference/' },
      { text: 'GitHub', link: 'https://github.com/geniuskey/AI-Lint' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '시작하기',
          items: [
            { text: 'AI-Lint란', link: '/guide/' },
            { text: '빠른 시작', link: '/guide/getting-started' },
            { text: '핵심 개념', link: '/guide/concepts' },
          ],
        },
        {
          text: '구성 요소',
          items: [
            { text: '백엔드', link: '/guide/backend' },
            { text: 'Confluence 확장', link: '/guide/extension' },
            { text: '데스크톱 앱', link: '/guide/desktop' },
            { text: '문서간 추적성', link: '/guide/traceability' },
          ],
        },
      ],
      '/rules/': [
        {
          text: '룰 카탈로그',
          items: [
            { text: '전체 목록', link: '/rules/' },
            { text: '구조 & 청킹 (STR)', link: '/rules/#구조-청킹-친화성-str' },
            { text: '맥락 자립성 (CTX)', link: '/rules/#맥락-자립성-ctx' },
            { text: '메타데이터 (META)', link: '/rules/#메타데이터-최신성-meta' },
            { text: '추적성 (TRC)', link: '/rules/#문서간-추적성-trc' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '레퍼런스',
          items: [
            { text: 'HTTP API', link: '/reference/api' },
            { text: '아키텍처', link: '/reference/architecture' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/geniuskey/AI-Lint' }],

    outline: { level: [2, 3], label: '목차' },
    docFooter: { prev: '이전', next: '다음' },
    darkModeSwitchLabel: '테마',
    returnToTopLabel: '맨 위로',
    sidebarMenuLabel: '메뉴',
    lastUpdatedText: '최종 수정',

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '검색', buttonAriaLabel: '검색' },
          modal: {
            noResultsText: '결과가 없습니다',
            resetButtonTitle: '초기화',
            footer: { selectText: '선택', navigateText: '이동', closeText: '닫기' },
          },
        },
      },
    },

    footer: {
      message: '사내 배포용 도구입니다.',
      copyright: 'AI-Lint',
    },
  },
})
