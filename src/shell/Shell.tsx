import { Suspense, lazy, useState } from 'react'
import BrandMark from '../components/BrandMark'
import { BRAND_NAME, BRAND_TAGLINE, BRAND_VERSION } from '../brand'
import App from '../App'
import '../App.css'
import './Shell.css'

const MockupStudio = lazy(() => import('../mockup/MockupStudio'))
const Calculadora = lazy(() => import('../calculadora/Calculadora'))

type Tab = 'folha' | 'calculadora' | 'mockup'

type Props = {
  onLogout: () => void
}

export default function Shell({ onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('folha')

  return (
    <div className="shell">
      <header className="shell-bar">
        <div className="shell-bar-inner">
          <div className="shell-brand" title={BRAND_TAGLINE}>
            <BrandMark size={28} />
            <div className="shell-brand-text">
              <span className="shell-brand-name">{BRAND_NAME}</span>
              <span className="shell-brand-sub">Personalizados · ML</span>
            </div>
          </div>

          <nav className="shell-segment" aria-label="Modos do aplicativo">
            <button
              type="button"
              className={`shell-seg ${tab === 'folha' ? 'active' : ''}`}
              onClick={() => setTab('folha')}
              aria-pressed={tab === 'folha'}
            >
              Folha
            </button>
            <button
              type="button"
              className={`shell-seg ${tab === 'calculadora' ? 'active' : ''}`}
              onClick={() => setTab('calculadora')}
              aria-pressed={tab === 'calculadora'}
            >
              Calculadora
            </button>
            <button
              type="button"
              className={`shell-seg ${tab === 'mockup' ? 'active' : ''}`}
              onClick={() => setTab('mockup')}
              aria-pressed={tab === 'mockup'}
            >
              Mockup
            </button>
          </nav>

          <div className="shell-user">
            <button
              type="button"
              className="btn ghost sm shell-logout"
              onClick={onLogout}
              title="Encerrar sessão"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="shell-body">
        {tab === 'folha' ? (
          <App />
        ) : tab === 'calculadora' ? (
          <Suspense
            fallback={
              <div className="shell-loading">
                <div className="shell-loading-card">Carregando calculadora…</div>
              </div>
            }
          >
            <Calculadora />
          </Suspense>
        ) : (
          <Suspense
            fallback={
              <div className="shell-loading">
                <div className="shell-loading-card">Carregando mockup…</div>
              </div>
            }
          >
            <MockupStudio />
          </Suspense>
        )}
      </div>

      <footer className="shell-footer">
        {BRAND_NAME} · {BRAND_VERSION} · processamento local no navegador
      </footer>
    </div>
  )
}
