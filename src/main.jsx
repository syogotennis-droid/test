import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import App from './App.jsx'
import TabletApp from './tablet/TabletApp.jsx'
import ErrorBoundary from './ErrorBoundary.jsx'
import './styles/global.css'

// Capacitorネイティブ（Android APK）は常にタブレットモード
const isNative = !!(window?.Capacitor?.isNativePlatform?.())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isNative ? (
        <TabletApp />
      ) : (
        <BrowserRouter>
          <Routes>
            <Route path="/tablet/*" element={<TabletApp />} />
            <Route path="/*" element={<App />} />
          </Routes>
        </BrowserRouter>
      )}
    </ErrorBoundary>
  </React.StrictMode>
)
