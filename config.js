/**
 * CONFIGURAÇÃO CENTRALIZADA DO SUPABASE
 *
 * Este arquivo centraliza todas as credenciais e configurações
 * Se precisar testar com diferentes ambientes, use variáveis de ambiente
 */

// ==========================================
// ADICIONE SUAS CREDENCIAIS AQUI
// ==========================================

const CONFIG = {
  // Sua URL do Supabase (Settings > API > Project URL)
  SUPABASE_URL: 'https://birtgmrtaryfjogegimn.supabase.co',

  // Sua Anon Key (Settings > API > anon key)
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpcnRnbXJ0YXJ5ZmpvZ2VnaW1uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NTcyNzEsImV4cCI6MjA5MzAzMzI3MX0.9Oly5423CjNAGc0dX75Jo2zFI4pf8kR0wpVA8u1bKUA',

  // Ambiente (development ou production)
  ENVIRONMENT: 'development',

  // URLs base
  API_URL: 'https://birtgmrtaryfjogegimn.supabase.co/rest/v1',
  AUTH_URL: 'https://birtgmrtaryfjogegimn.supabase.co/auth/v1',

  // Outras configurações
  TIMEOUT: 10000, // 10 segundos
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
};

// ==========================================
// VALIDAÇÃO DE CONFIGURAÇÃO
// ==========================================

function validateConfig() {
  const requiredFields = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const missing = requiredFields.filter(field => {
    return CONFIG[field] === 'https://seu-projeto.supabase.co' ||
           CONFIG[field].startsWith('eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9');
  });

  if (missing.length > 0) {
    console.warn('⚠️ Configuração incompleta:', missing.join(', '));
    console.warn('Adicione suas credenciais Supabase em config.js');
    return false;
  }

  return true;
}

// Validar ao carregar
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    if (!validateConfig()) {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        font-family: Arial, sans-serif;
        color: white;
      `;
      errorDiv.innerHTML = `
        <div style="max-width: 500px; text-align: center;">
          <h1>⚠️ Configuração Necessária</h1>
          <p>Você precisa adicionar suas credenciais Supabase em <strong>config.js</strong></p>
          <ol style="text-align: left; margin: 20px auto;">
            <li>Abra <strong>config.js</strong></li>
            <li>Vá ao Supabase: Settings > API</li>
            <li>Copie a <strong>Project URL</strong></li>
            <li>Copie a <strong>anon key</strong></li>
            <li>Cole em config.js (linhas 10-11)</li>
            <li>Salve e recarregue a página</li>
          </ol>
          <p style="color: #fbbf24; margin-top: 20px;">
            Ou abra o console do navegador (F12) para ver mais detalhes
          </p>
        </div>
      `;
      document.body.innerHTML = '';
      document.body.appendChild(errorDiv);
    }
  });
}

// Expor globalmente no navegador
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}

// Exportar para Node.js (se necessário)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
