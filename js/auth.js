/**
 * FUNÇÕES DE AUTENTICAÇÃO
 * Integração com Supabase Auth
 */

class AuthManager {
  constructor(config) {
    this.config = config;
    this.currentUser = null;
    this.session = null;
    this.loadSession();
  }

  /**
   * Carregar sessão existente do localStorage
   */
  loadSession() {
    try {
      const sessionData = localStorage.getItem('supabase.auth.token');
      if (sessionData) {
        const session = JSON.parse(sessionData);

        // Verificar se token ainda é válido
        if (session.access_token && session.user) {
          this.session = session;
          this.currentUser = session.user;
          console.log('✓ Sessão carregada:', this.currentUser.email);
        }
      }
    } catch (error) {
      console.error('Erro ao carregar sessão:', error);
      this.session = null;
      this.currentUser = null;
    }
  }

  /**
   * Fazer login com email e senha
   */
  async signIn(email, password) {
    try {
      const response = await fetch(`${this.config.AUTH_URL}/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || data.message || 'Erro ao fazer login');
      }

      // Salvar sessão
      this.session = data;
      this.currentUser = data.user;
      localStorage.setItem('supabase.auth.token', JSON.stringify(data));

      console.log('✓ Login bem-sucedido:', email);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Erro no login:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Criar conta (sign up)
   */
  async signUp(email, password, metadata = {}) {
    try {
      const response = await fetch(`${this.config.AUTH_URL}/signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          email: email.trim(),
          password: password,
          data: metadata,
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || 'Erro ao criar conta');
      }

      console.log('✓ Conta criada:', email);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('Erro ao criar conta:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Criar perfil do professor após signup
   */
  async createProfile(userId, profileData) {
    try {
      if (!this.session?.access_token) {
        throw new Error('Usuário não autenticado');
      }

      const response = await fetch(`${this.config.API_URL}/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.session.access_token}`,
        },
        body: JSON.stringify({
          id: userId,
          email: profileData.email,
          full_name: profileData.full_name,
          school_name: profileData.school_name,
        }),
      });

      if (!response.ok) {
        throw new Error('Erro ao criar perfil');
      }

      console.log('✓ Perfil criado');
      return { success: true };
    } catch (error) {
      console.error('Erro ao criar perfil:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Fazer logout
   */
  async signOut() {
    this.session = null;
    this.currentUser = null;
    localStorage.removeItem('supabase.auth.token');
    console.log('✓ Logout realizado');
    return { success: true };
  }

  /**
   * Verificar se está autenticado
   */
  isAuthenticated() {
    return !!this.session && !!this.currentUser;
  }

  /**
   * Obter usuário atual
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Obter token de acesso
   */
  getAccessToken() {
    return this.session?.access_token || null;
  }

  /**
   * Fazer requisição autenticada
   */
  async authenticatedRequest(endpoint, options = {}) {
    if (!this.session?.access_token) {
      throw new Error('Usuário não autenticado');
    }

    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.config.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${this.session.access_token}`,
      ...options.headers,
    };

    const response = await fetch(`${this.config.API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.statusText}`);
    }

    // Alguns endpoints retornam texto vazio
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return response.json();
    }

    return response.text();
  }

  /**
   * Resetar senha
   */
  async resetPassword(email) {
    try {
      const response = await fetch(`${this.config.AUTH_URL}/recover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || 'Erro ao resetar senha');
      }

      console.log('✓ Email de reset enviado');
      return { success: true };
    } catch (error) {
      console.error('Erro ao resetar senha:', error.message);
      return { success: false, error: error.message };
    }
  }
}

// Criar instância global (será inicializada em cada página)
let authManager = null;

function initAuthManager() {
  if (!window.CONFIG) {
    console.error('CONFIG não carregado. Certifique-se de incluir config.js antes de auth.js');
    return null;
  }
  authManager = new AuthManager(window.CONFIG);
  return authManager;
}

// Exportar
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AuthManager, initAuthManager };
}
