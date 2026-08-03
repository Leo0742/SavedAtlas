import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import './styles.css'

export function IntegrationError() {
  const diagnostics = `SavedAtlas integration error\nPreload API: unavailable\nPlatform: ${navigator.platform}\nApp version: 1.0.0`
  return <main className="integration-error"><h1>Не удалось запустить SavedAtlas</h1><p>Защищённый preload API не загрузился. Демо-данные не были открыты.</p><pre>{diagnostics}</pre><div><button onClick={() => void navigator.clipboard.writeText(diagnostics)}>Копировать диагностику</button><button onClick={() => window.close()}>Выйти</button></div></main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{window.savedAtlas ? <App /> : <IntegrationError />}</React.StrictMode>)
