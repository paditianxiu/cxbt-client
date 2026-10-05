import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 强制监听所有网卡，解决 localhost 拒绝连接的问题
    open: true,
  },
})
