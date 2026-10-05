import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import AssetViewer from './features/cacheAssets/AssetViewer.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.pathname.endsWith('/assets-viewer') ? <AssetViewer /> : <App />}
  </StrictMode>,
)
