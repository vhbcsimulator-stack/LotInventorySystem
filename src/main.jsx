import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Provider } from '@/components/ui/provider'
import { queryClient } from '@/data/queryClient'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Provider>
        <App />
      </Provider>
    </QueryClientProvider>
  </StrictMode>,
)
