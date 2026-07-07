import React from 'react';
import { t } from './i18n';

type State = { error: Error | null };

// Arayüzde beklenmedik bir render hatası olursa boş ekran yerine kurtarma
// ekranı gösterir (uygulama tamamen kilitlenmez).
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Cboinn UI hatası:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const e = this.state.error;
      return (
        <div
          style={{
            padding: 32,
            color: '#e8edf6',
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            height: '100%',
            overflow: 'auto',
            background: '#0a0e1a',
          }}
        >
          <h2 style={{ color: '#ef4444', margin: '0 0 8px' }}>{t('Beklenmedik bir hata oluştu')}</h2>
          <p style={{ color: '#9fb4d4', marginTop: 0 }}>
            {t('Arayüzde bir sorun oluştu. "Yeniden Yükle" ile devam edebilirsin; sorun sürerse uygulamayı kapatıp aç.')}
          </p>
          <pre
            style={{
              fontSize: 12,
              color: '#6b7a93',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 280,
              overflow: 'auto',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 8,
              padding: 12,
            }}
          >
            {String((e && e.stack) || (e && e.message) || e)}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 12,
              padding: '8px 18px',
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t('Yeniden Yükle')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
