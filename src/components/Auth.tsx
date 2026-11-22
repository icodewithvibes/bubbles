import { useState, type FormEvent } from 'react'

import { authError, doSignOut, finishOnboarding, onboardDefaults, signIn, signUp } from '@/services/session'
import { Logo } from './ui'

export function BootScreen() {
  return (
    <div id="boot" className="screen">
      <div className="boot-logo">
        <Logo />
      </div>
    </div>
  )
}

export function AuthScreen() {
  const [signup, setSignup] = useState(false)
  const [name, setName] = useState('')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (signup) await signUp(user.trim(), pass, pass2, name.trim())
      else await signIn(user.trim(), pass)
    } catch (ex) {
      setErr(authError(ex))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="auth" className="screen">
      <form className="card stack" onSubmit={submit} noValidate>
        <div className="logo-big">
          <Logo />
        </div>
        <h1>{signup ? 'Create account' : 'Bubbles'}</h1>
        <p className="muted">{signup ? 'Just a username and password. No email needed.' : 'Sign in to chat with your friends.'}</p>
        {signup && (
          <label className="field">
            Display name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} autoComplete="nickname" placeholder="What friends see" />
          </label>
        )}
        <label className="field">
          Username
          <span className="at-input">
            <span>@</span>
            <input
              value={user}
              onChange={(e) => setUser(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              maxLength={20}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </span>
        </label>
        <label className="field">
          Password
          <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} minLength={6} required />
        </label>
        {signup && (
          <label className="field">
            Confirm password
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" minLength={6} />
          </label>
        )}
        {signup && (
          <p className="hint">Usernames are 3–20 characters: lowercase letters, numbers and _. No email needed — just don't forget your password.</p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {signup ? 'Create Account' : 'Sign In'}
        </button>
        <p className="form-err" role="alert">
          {err}
        </p>
        <p className="auth-alt">
          <span>{signup ? 'Have an account?' : 'New here?'}</span>{' '}
          <button
            className="link"
            type="button"
            onClick={() => {
              setSignup(!signup)
              setErr('')
            }}
          >
            {signup ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </section>
  )
}

export function OnboardScreen() {
  const defaults = onboardDefaults()
  const [name, setName] = useState(defaults.name)
  const [err, setErr] = useState('')
  return (
    <section id="onboard" className="screen">
      <form
        className="card stack"
        onSubmit={async (e) => {
          e.preventDefault()
          try {
            await finishOnboarding(name.trim())
          } catch (ex) {
            setErr((ex as Error).message || 'Could not save your profile.')
          }
        }}
      >
        <h1>Finish setting up</h1>
        <p className="muted">Pick the name your friends will see.</p>
        <label className="field">
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required />
        </label>
        <p className="hint">
          Your username is <b>@{defaults.username}</b>
        </p>
        <button className="btn btn-primary" type="submit">
          Continue
        </button>
        <p className="form-err" role="alert">
          {err}
        </p>
        <button className="link" type="button" onClick={() => void doSignOut()}>
          Sign out
        </button>
      </form>
    </section>
  )
}
