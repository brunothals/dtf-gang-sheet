import { useState } from 'react'
import type { FormEvent } from 'react'
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
      <form className="login-card card" onSubmit={handleSubmit}>
        <h1>DTF UV — Acesso</h1>
        <p className="login-sub">Entre com usuário e senha para continuar.</p>

        <label className="field">
          <span>Usuário</span>
          <input
            type="text"
            autoComplete="username"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
            disabled={busy}
            autoFocus
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
          />
        </label>

        {erro && <p className="login-error">{erro}</p>}

        <button type="submit" className="btn primary login-btn" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
