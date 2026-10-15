import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://seba.sousadev.com',
  integrations: [sitemap()],
});
