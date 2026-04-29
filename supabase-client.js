/**
 * SUPABASE CLIENT CONFIGURATION
 *
 * Este arquivo configura a conexão com o Supabase.
 *
 * SETUP:
 * 1. Acesse https://supabase.com
 * 2. Crie uma conta e novo projeto
 * 3. Vá em Settings > API
 * 4. Copie a "Project URL" e "Anon Key"
 * 5. Cole os valores abaixo
 */

const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_KEY';

/**
 * Criar cliente Supabase
 * Note: Este código assume que você tem acesso à biblioteca supabase-js
 * Você pode incluir via CDN ou npm
 */

class SupabaseClient {
    constructor(url, anonKey) {
        this.url = url;
        this.anonKey = anonKey;
        this.session = null;
        this.user = null;
        this.loadSession();
    }

    /**
     * Verificar se há sessão ativa
     */
    loadSession() {
        const sessionData = localStorage.getItem('supabase.auth.token');
        if (sessionData) {
            try {
                this.session = JSON.parse(sessionData);
                this.user = this.session.user;
            } catch (e) {
                console.warn('Sessão inválida', e);
                this.session = null;
            }
        }
    }

    /**
     * Fazer login
     */
    async signIn(email, password) {
        try {
            const response = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                },
                body: JSON.stringify({
                    email,
                    password,
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'Erro ao fazer login');
            }

            // Salvar sessão localmente
            this.session = data;
            this.user = data.user;
            localStorage.setItem('supabase.auth.token', JSON.stringify(data));

            return { user: data.user, error: null };
        } catch (error) {
            return { user: null, error: error.message };
        }
    }

    /**
     * Criar conta (Sign Up)
     */
    async signUp(email, password, metadata = {}) {
        try {
            const response = await fetch(`${this.url}/auth/v1/signup`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': this.anonKey,
                },
                body: JSON.stringify({
                    email,
                    password,
                    data: metadata,
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || 'Erro ao criar conta');
            }

            return { user: data.user, error: null };
        } catch (error) {
            return { user: null, error: error.message };
        }
    }

    /**
     * Fazer logout
     */
    async signOut() {
        this.session = null;
        this.user = null;
        localStorage.removeItem('supabase.auth.token');
    }

    /**
     * Verificar se está autenticado
     */
    isAuthenticated() {
        return !!this.session && !!this.user;
    }

    /**
     * Fazer requisição autenticada
     */
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'apikey': this.anonKey,
            ...options.headers
        };

        // Adicionar token de autenticação se estiver logado
        if (this.session) {
            headers['Authorization'] = `Bearer ${this.session.access_token}`;
        }

        const response = await fetch(`${this.url}${endpoint}`, {
            ...options,
            headers,
        });

        if (!response.ok) {
            throw new Error(`Erro na requisição: ${response.statusText}`);
        }

        return response.json();
    }

    /**
     * Query na tabela
     */
    async from(table) {
        return {
            select: async (columns = '*') => {
                const data = await this.request(`/rest/v1/${table}?select=${columns}`);
                return { data, error: null };
            },
            insert: async (rows) => {
                const data = await this.request(`/rest/v1/${table}`, {
                    method: 'POST',
                    body: JSON.stringify(rows),
                });
                return { data, error: null };
            },
            update: async (updates) => {
                const data = await this.request(`/rest/v1/${table}`, {
                    method: 'PATCH',
                    body: JSON.stringify(updates),
                });
                return { data, error: null };
            },
            delete: async () => {
                const data = await this.request(`/rest/v1/${table}`, {
                    method: 'DELETE',
                });
                return { data, error: null };
            }
        };
    }

    /**
     * Upload de arquivo
     */
    async uploadFile(bucket, path, file) {
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(
                `${this.url}/storage/v1/object/${bucket}/${path}`,
                {
                    method: 'POST',
                    headers: {
                        'apikey': this.anonKey,
                        'Authorization': `Bearer ${this.session.access_token}`,
                    },
                    body: formData,
                }
            );

            if (!response.ok) {
                throw new Error('Erro ao fazer upload');
            }

            return {
                path,
                fullPath: `${bucket}/${path}`,
                error: null
            };
        } catch (error) {
            return { path: null, error: error.message };
        }
    }
}

// Exportar instância global
const supabase = new SupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * USO:
 *
 * // Login
 * const { user, error } = await supabase.signIn('email@example.com', 'password');
 *
 * // Sign Up
 * const { user, error } = await supabase.signUp('email@example.com', 'password', {
 *   full_name: 'João Silva',
 *   school_name: 'Escola XYZ'
 * });
 *
 * // Verificar autenticação
 * if (supabase.isAuthenticated()) {
 *   console.log('Usuário autenticado:', supabase.user.email);
 * }
 *
 * // Logout
 * await supabase.signOut();
 *
 * // Query (exemplo com Fetch puro)
 * const response = await fetch(
 *   'https://seu-projeto.supabase.co/rest/v1/exams?select=*',
 *   {
 *     headers: {
 *       'apikey': 'sua-anon-key',
 *       'Authorization': `Bearer ${supabase.session.access_token}`
 *     }
 *   }
 * );
 */
