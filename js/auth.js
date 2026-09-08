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
    this.refreshPromise = null;
    this.sessionGeneration = 0;
    this.loadSession();
    if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
      if (event.key !== 'supabase.auth.token') return;
      const previousUserId = this.currentUser?.id;
      this.session = null;
      this.currentUser = null;
      this.currentProfile = null;
      this.loadSession();
      if (!this.currentUser || this.currentUser.id !== previousUserId) this.sessionGeneration += 1;
      window.dispatchEvent(new Event('auth-session-changed'));
    });
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
        }
      }
    } catch (error) {
      console.error('Erro ao carregar sessão:', error);
      this.session = null;
      this.currentUser = null;
    }
  }

  async fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.config.TIMEOUT || 10000);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('A conexão demorou demais. Suas alterações continuam pendentes; tente novamente.');
      throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', cancel);
    }
  }

  saveSession(data) {
    this.session = { ...data, expires_at: data.expires_at || (data.expires_in ? Math.floor(Date.now() / 1000) + data.expires_in : undefined) };
    this.currentUser = data.user || this.currentUser;
    this.currentProfile = data.profile || this.currentProfile;
    localStorage.setItem('supabase.auth.token', JSON.stringify(this.session));
  }

  async ensureAccessToken(force = false) {
    if (!this.session?.access_token) throw new Error('Entre novamente para continuar.');
    const expiresSoon = this.session.expires_at && this.session.expires_at * 1000 < Date.now() + 30000;
    if (!force && !expiresSoon) return this.session.access_token;
    if (this.refreshPromise) return this.refreshPromise;
    if (!this.session.refresh_token) throw new Error('Sessão expirada. Entre novamente para salvar suas alterações.');
    const oldToken = this.session.access_token;
    const generation = this.sessionGeneration;
    const refresh = async () => {
      // Outra aba pode ter renovado enquanto esta esperava pelo lock.
      const stored = JSON.parse(localStorage.getItem('supabase.auth.token') || 'null');
      if (generation !== this.sessionGeneration || !this.session) throw new Error('A sessão foi encerrada.');
      if (stored?.user?.id !== this.currentUser?.id) throw new Error('A conta foi alterada. Entre novamente.');
      if (stored?.access_token && stored.access_token !== oldToken) {
        this.saveSession(stored);
        return this.session.access_token;
      }
      const response = await this.fetchWithTimeout(`${this.config.AUTH_URL}/token?grant_type=refresh_token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: this.config.SUPABASE_ANON_KEY },
        body: JSON.stringify({ refresh_token: this.session.refresh_token }),
      });
      const data = await response.json();
      if (!response.ok || !data.access_token) throw new Error('Não foi possível renovar a sessão. Entre novamente para salvar suas alterações.');
      if (generation !== this.sessionGeneration || !this.session) throw new Error('A sessão foi encerrada.');
      this.saveSession({ ...data, profile: this.currentProfile });
      return data.access_token;
    };
    this.refreshPromise = (typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('gerador-provas-auth-refresh', refresh) : refresh());
    try { return await this.refreshPromise; }
    finally { this.refreshPromise = null; }
  }

  /**
   * Fazer login com email e senha
   */
  async signIn(email, password) {
    try {
      const response = await this.fetchWithTimeout(`${this.config.AUTH_URL}/token?grant_type=password`, {
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
      this.sessionGeneration += 1;
      this.currentProfile = null;
      this.saveSession(data);

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
      const response = await this.fetchWithTimeout(`${this.config.AUTH_URL}/signup`, {
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

      const response = await this.fetchWithTimeout(`${this.config.API_URL}/profiles`, {
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
    const token = this.session?.access_token;
    this.sessionGeneration += 1;
    this.session = null;
    this.currentUser = null;
    this.currentProfile = null;
    localStorage.removeItem('supabase.auth.token');
    let serverRevoked = !token;
    if (token) {
      try {
        const response = await this.fetchWithTimeout(`${this.config.AUTH_URL}/logout?scope=local`, {
          method: 'POST', headers: { apikey: this.config.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        });
        serverRevoked = response.ok;
      } catch { /* A sessão local deve ser encerrada mesmo sem conexão. */ }
    }
    return { success: true, serverRevoked };
  }

  /**
   * Verificar se está autenticado
   */
  isAuthenticated() {
    return Boolean(this.session?.access_token && this.currentUser &&
      (!this.session.expires_at || this.session.expires_at * 1000 > Date.now() || this.session.refresh_token));
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

  async loadCurrentProfile(select = 'id,email,full_name,role,school_id,school_grade,disciplines,force_password_change') {
    const user = this.getCurrentUser();
    if (!user?.id) return null;
    const data = await this.authenticatedRequest(`/profiles?id=eq.${user.id}&select=${select}`);
    if (this.currentUser?.id !== user.id) throw new Error('A conta foi alterada durante o carregamento.');
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
    return user?.id === exam.user_id && !['enviada', 'em_revisao', 'aprovada', 'bloqueada'].includes(exam.review_status || 'rascunho');
  }

  canDeleteExam(exam, profile = this.currentProfile) {
    if (!exam) return false;
    const user = this.getCurrentUser();
    if (this.hasRole(['master', 'school_owner'], profile)) return true;
    return user?.id === exam.user_id && !['enviada', 'em_revisao', 'aprovada', 'bloqueada'].includes(exam.review_status || 'rascunho');
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

      const response = await this.fetchWithTimeout(`${this.config.AUTH_URL}/user`, {
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

    await this.ensureAccessToken();
    const headers = {
      'Content-Type': 'application/json',
      'apikey': this.config.SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${this.session.access_token}`,
      ...options.headers,
    };

    let response = await this.fetchWithTimeout(`${this.config.API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && this.session?.refresh_token) {
      headers.Authorization = `Bearer ${await this.ensureAccessToken(true)}`;
      response = await this.fetchWithTimeout(`${this.config.API_URL}${endpoint}`, { ...options, headers });
    }

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
    const body = await response.text();
    if (!body) return '';
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(body) : body;
  }

  /**
   * Resetar senha
   */
  async resetPassword(email, redirectTo = '') {
    try {
      const url = redirectTo
        ? `${this.config.AUTH_URL}/recover?redirect_to=${encodeURIComponent(redirectTo)}`
        : `${this.config.AUTH_URL}/recover`;
      const response = await this.fetchWithTimeout(url, {
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
