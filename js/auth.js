/**
 * FUNÇÕES DE AUTENTICAÇÃO
 * Integração com Supabase Auth
 */

class AuthManager {
  constructor(config) {
    this.config = config;
    this.currentUser = null;
    this.currentProfile = null;
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
          this.currentProfile = session.profile || null;
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
      this.currentProfile = null;
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
    this.currentProfile = null;
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

  normalizeRole(role) {
    const aliases = {
      admin: 'master',
      coordenadora: 'coordinator',
      professor: 'teacher',
      impressao: 'print_operator',
    };
    return aliases[role] || role || 'teacher';
  }

  async loadCurrentProfile(select = 'id,email,full_name,school_name,role,school_id,school_grade,disciplines,force_password_change') {
    const user = this.getCurrentUser();
    if (!user?.id) return null;
    const data = await this.authenticatedRequest(`/profiles?id=eq.${user.id}&select=${select}`);
    const profile = Array.isArray(data) ? data[0] : null;
    this.currentProfile = profile ? { ...profile, normalized_role: this.normalizeRole(profile.role) } : null;
    if (this.session) {
      this.session.profile = this.currentProfile;
      localStorage.setItem('supabase.auth.token', JSON.stringify(this.session));
    }
    return this.currentProfile;
  }

  getCurrentProfile() {
    return this.currentProfile;
  }

  getRole(profile = this.currentProfile) {
    return this.normalizeRole(profile?.role);
  }

  hasRole(roles, profile = this.currentProfile) {
    return roles.includes(this.getRole(profile));
  }

  canManageSchools(profile = this.currentProfile) {
    return this.hasRole(['master', 'school_owner'], profile);
  }

  canManageUsers(profile = this.currentProfile) {
    return this.hasRole(['master', 'school_owner', 'coordinator'], profile);
  }

  canReviewExams(profile = this.currentProfile) {
    return this.hasRole(['master', 'school_owner', 'coordinator'], profile);
  }

  canAccessPrintQueue(profile = this.currentProfile) {
    return this.hasRole(['master', 'school_owner', 'print_operator'], profile);
  }

  canEditExam(exam, profile = this.currentProfile) {
    if (!exam) return false;
    const user = this.getCurrentUser();
    if (this.canReviewExams(profile)) return true;
    return user?.id === exam.user_id && !['aprovada', 'bloqueada'].includes(exam.review_status || 'rascunho');
  }

  canDeleteExam(exam, profile = this.currentProfile) {
    if (!exam) return false;
    const user = this.getCurrentUser();
    if (this.hasRole(['master', 'school_owner'], profile)) return true;
    return user?.id === exam.user_id && !['aprovada', 'bloqueada'].includes(exam.review_status || 'rascunho');
  }

  canManageQuestionBank(profile = this.currentProfile) {
    return this.hasRole(['master', 'school_owner', 'coordinator', 'teacher'], profile);
  }

  /**
   * Obter token de acesso
   */
  getAccessToken() {
    return this.session?.access_token || null;
  }

  /**
   * Usar token temporário recebido no link de recuperação de senha
   */
  startRecoverySession(accessToken, refreshToken = '') {
    this.session = {
      access_token: accessToken,
      refresh_token: refreshToken,
      user: null,
    };
    this.currentUser = null;
  }

  /**
   * Atualizar senha usando a sessão atual
   */
  async updatePassword(newPassword, metadata = null) {
    try {
      if (!this.session?.access_token) {
        throw new Error('Sessão de recuperação inválida');
      }

      const response = await fetch(`${this.config.AUTH_URL}/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.config.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${this.session.access_token}`,
        },
        body: JSON.stringify({
          password: newPassword,
          ...(metadata ? { data: metadata } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok || data.error) {
        throw new Error(data.error?.message || data.message || 'Erro ao atualizar senha');
      }

      const updatedUser = data?.user || (data?.id ? data : null);
      if (updatedUser && this.session) {
        this.currentUser = updatedUser;
        this.session.user = updatedUser;
        localStorage.setItem('supabase.auth.token', JSON.stringify(this.session));
      }
      if (metadata && this.session?.user) {
        this.session.user.user_metadata = {
          ...(this.session.user.user_metadata || {}),
          ...metadata,
        };
        this.currentUser = this.session.user;
        localStorage.setItem('supabase.auth.token', JSON.stringify(this.session));
      }

      return { success: true };
    } catch (error) {
      console.error('Erro ao atualizar senha:', error.message);
      return { success: false, error: error.message };
    }
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
      let detail = response.statusText || `HTTP ${response.status}`;
      try {
        const text = await response.text();
        if (text) {
          try {
            const data = JSON.parse(text);
            detail = data.message || data.error_description || data.details || data.hint || text;
          } catch {
            detail = text;
          }
        }
      } catch {
        // Mantem o statusText como fallback.
      }
      throw new Error(`Erro na requisição: ${detail}`);
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
  async resetPassword(email, redirectTo = '') {
    try {
      const url = redirectTo
        ? `${this.config.AUTH_URL}/recover?redirect_to=${encodeURIComponent(redirectTo)}`
        : `${this.config.AUTH_URL}/recover`;
      const response = await fetch(url, {
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
