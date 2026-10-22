// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'RunSecure',
  tagline: 'Documentation and blog for HkdfGuard and other RunSecure Projects',
  favicon: 'img/favicon.ico',
  url: 'https://runsecure.github.io',
  // Served from the org site (runsecure/runsecure.github.io), not this repo's project site.
  baseUrl: '/',
  organizationName: 'runsecure',
  projectName: 'runsecure.github.io',
  deploymentBranch: 'main',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  i18n: {defaultLocale: 'en', locales: ['en']},
  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/docs',
          editUrl: 'https://github.com/runsecure/runsecure.github.io/tree/main/',
        },
        blog: {
          showReadingTime: true,
          editUrl: 'https://github.com/runsecure/runsecure.github.io/tree/main/',
        },
        theme: {customCss: './src/css/custom.css'},
      }),
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'HkdfGuard',
      items: [
        {type: 'docSidebar', sidebarId: 'docsSidebar', position: 'left', label: 'Docs'},
        {to: '/blog', label: 'Blog', position: 'left'},
        {href: 'https://github.com/runsecure/runsecure.github.io', label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright © ${new Date().getFullYear()} RunSecure. Built with Docusaurus.`,
    },
    prism: {theme: prismThemes.github, darkTheme: prismThemes.dracula},
  },
};

export default config;
