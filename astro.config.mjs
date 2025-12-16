// config import
import { defineConfig } from 'astro/config';

// integrations import
import react from "@astrojs/react";
import mdx from '@astrojs/mdx';
import compress from '@playform/compress';
import sitemap from "@astrojs/sitemap";
import astroExpressiveCode from 'astro-expressive-code';
import icon from 'astro-icon';
import partytown from "@astrojs/partytown";

/** @type {import('astro-expressive-code').AstroExpressiveCodeOptions} */
const astroExpressiveCodeOptions = {
  // Example: Change the theme to "dracula"
  theme: 'min-dark'
};


// https://astro.build/config
export default defineConfig({
  site: 'https://aritraroy.live',
  integrations: [react(), astroExpressiveCode(astroExpressiveCodeOptions), mdx(), sitemap(), icon(), partytown({
    config: {
      forward: ['dataLayer.push'],
    },
  }), compress()],
  image: {
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        limitInputPixels: false,
      },
    },
  },
  markdown: {
    shikiConfig: {
      theme: 'min-dark',
      langs: [],
      wrap: true
    }
  },
  vite: {
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
    },
    ssr: {
      noExternal: ["react-icons"]
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler'
        },
        sass: {
          api: 'modern-compiler'
        }
      }
    },
    build: {
      rollupOptions: {
        external: ['sharp', 'detect-libc']
      }
    }
  },
  compressHTML: true
});