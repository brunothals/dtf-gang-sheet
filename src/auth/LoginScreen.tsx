import { useState } from 'react'
import type { FormEvent } from 'react'
import BrandMark from '../components/BrandMark'
import { BRAND_NAME, BRAND_TAGLINE } from '../brand'
import { AUTH_SESSION_KEY, PASSWORD_SHA256_HEX, USERNAME } from './credentials'
import { sha256Hex } from './hash'

type Props = {
  onSuccess: () => void
}

export default function LoginScreen({ onSuccess }: Props) {
  const [usuario, setUsuario] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setErro('')
    setBusy(true)
    try {
      const hash = await sha256Hex(senha)
      const userOk = usuario.trim() === USERNAME
      const passOk = hash === PASSWORD_SHA256_HEX
      if (!userOk || !passOk) {
        setErro('Usuário ou senha incorretos')
        return
      }
      sessionStorage.setItem(AUTH_SESSION_KEY, '1')
      onSuccess()
    } catch {
      setErro('Usuário ou senha incorretos')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-ambient" aria-hidden />
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-brand">
          <BrandMark size={44} className="login-logo" />
          <div>
            <h1>{BRAND_NAME}</h1>
            <p className="login-tagline">{BRAND_TAGLINE}</p>
          </div>
        </div>

        <p className="login-sub">Acesso privado · entre com suas credenciais</p>

        <label className="field">
          <span>Usuário</span>
          <input
            type="text"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            disabled={busy}
            autoFocus
            placeholder="Seu usuário"
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            disabled={busy}
            placeholder="••••••••"
          />
        </label>

        {erro && (
          <p className="login-error" role="alert">
            {erro}
          </p>
        )}

        <button type="submit" className="btn primary login-btn" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="login-note">Processamento local no navegador · nada é enviado ao servidor</p>
        <p className="login-soon">Em breve: planos SaaS</p>
      </form>
    </div>
  )
}
