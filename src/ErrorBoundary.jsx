import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || String(error) }
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100dvh', gap: 16, padding: 24, textAlign: 'center', fontFamily: 'sans-serif' }}>
        <span style={{ fontSize: '2.5rem' }}>⚠️</span>
        <p style={{ fontWeight: 700, fontSize: '1.1rem' }}>エラーが発生しました</p>
        <p style={{ color: '#666', fontSize: '0.85rem', maxWidth: 300 }}>{this.state.message}</p>
        <button
          onClick={() => window.location.reload()}
          style={{ padding: '10px 28px', borderRadius: 10, border: 'none', background: '#1a5fa8', color: '#fff', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' }}
        >
          再読み込み
        </button>
      </div>
    )
  }
}
