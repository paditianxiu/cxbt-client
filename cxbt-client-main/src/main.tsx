import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AssetViewer from './features/cacheAssets/AssetViewer.tsx'
import Sandbox from './sandbox/index'

const path = location.pathname;
createRoot(document.getElementById('root')!).render(
  path.endsWith('/assets-viewer') ? <AssetViewer /> : 
  path.endsWith('/sandbox') ? <Sandbox /> : 
  <App />
)
