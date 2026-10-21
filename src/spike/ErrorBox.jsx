// SPIKE ONLY — the spike mounts outside the app's ErrorBoundary, so a throw
// blanks the page with no clue. This surfaces the message on screen instead.
import { Component } from 'react'

export default class ErrorBox extends Component {
  constructor(p) { super(p); this.state = { err: null, info: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err, info) { this.setState({ info }); console.error('[spike]', err, info) }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div style={{ padding: 20, fontFamily: 'Carlito, Calibri, sans-serif', overflow: 'auto', height: '100%' }}>
        <h2 style={{ color: '#b42318', fontSize: 16, margin: '0 0 8px' }}>
          {this.props.label} crashed
        </h2>
        <pre style={{ background: '#fbeaea', border: '1px solid #b42318', padding: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}>
{String(this.state.err?.stack || this.state.err)}
        </pre>
        <pre style={{ background: '#f4f4f4', padding: 12, fontSize: 11, whiteSpace: 'pre-wrap', color: '#565656' }}>
{String(this.state.info?.componentStack || '').split('\n').slice(0, 12).join('\n')}
        </pre>
      </div>
    )
  }
}
