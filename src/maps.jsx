/*
 * Entry for the public map gallery (maps/index.html → /maps/). Its own page,
 * so it loads none of the portal and needs no sign-in or server rewrite.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from '@/components/ui/provider'
import MapGalleryPage from '@/pages/MapGalleryPage'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider>
      <MapGalleryPage />
    </Provider>
  </StrictMode>,
)
