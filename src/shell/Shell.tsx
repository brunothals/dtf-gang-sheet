import { Suspense, lazy, useState } from 'react'
import App from '../App'
import '../App.css'
import './Shell.css'

const MockupStudio = lazy(() => import('../mockup/MockupStudio'))

type Tab = 'folha' | 'mockup'

type Props = {
  onLogout: () => void
}

export default function Shell({ onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('folha')

  return (
    <div className="shell">
      <nav className="shell-tabs" aria-label="Modos do aplicativo">
        <div className="shell-tabs-inner">
          <button
            type="button"
            className={`shell-tab ${tab === 'folha' ? 'active' : ''}`}
            onClick={() => setTab('folha')}
          >
            Folha (Gang Sheet)
          </button>
          <button
            type="button"
            className={`shell-tab ${tab === 'mockup' ? 'active' : ''}`}
            onClick={() => setTab('mockup')}
          >
            Mockup
          </button>
        </div>
        <button
          type="button"
          className="btn sm logout-btn shell-logout"
          onClick={onLogout}
          title="Encerrar sessão"
        >
          Sair
        </button>
      </nav>

      {tab === 'folha' ? (
        <App />
      ) : (
        <Suspense fallback={<p className="shell-loading">Carregando mockup…</p>}>
          <MockupStudio />
        </Suspense>
      )}
    </div>
  )
}
