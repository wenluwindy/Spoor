import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

/** 与 tp- Token 套餐控制台一致；开发代理转发到此前缀 */
const MIMO_PROXY_TARGET = 'https://token-plan-cn.xiaomimimo.com/v1';
/**
 * dev/preview 的同源代理。
 *
 * 网页版已废弃，但 `npm run dev` 仍是浏览器里调 UI 的手段，那里没有 Tauri 的
 * 后端可绕 CORS，所以这几条代理保留。它们只存在于 vite 的开发服务器配置里，
 * 不进构建产物。桌面端一律走 Rust 侧的 `openai_compatible_chat`。
 */
/** DeepSeek OpenAI-compatible API proxy target */
const DEEPSEEK_PROXY_TARGET = 'https://api.deepseek.com/v1';
/** 秘塔搜索 API 代理目标 */
const METASO_PROXY_TARGET = 'https://metaso.cn';
/** Volcengine Ark (Doubao) OpenAI-compatible API proxy target */
const DOUBAO_PROXY_TARGET = 'https://ark.cn-beijing.volces.com/api/v3';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/mimo': {
          target: MIMO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/mimo/, ''),
        },
        '/api/deepseek': {
          target: DEEPSEEK_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/deepseek/, ''),
        },
        '/api/doubao': {
          target: DOUBAO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/doubao/, ''),
        },
        '/api/metaso': {
          target: METASO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/metaso/, ''),
        },
      },
    },
    preview: {
      proxy: {
        '/api/mimo': {
          target: MIMO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/mimo/, ''),
        },
        '/api/deepseek': {
          target: DEEPSEEK_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/deepseek/, ''),
        },
        '/api/doubao': {
          target: DOUBAO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/doubao/, ''),
        },
        '/api/metaso': {
          target: METASO_PROXY_TARGET,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api\/metaso/, ''),
        },
      },
    },
  };
});
