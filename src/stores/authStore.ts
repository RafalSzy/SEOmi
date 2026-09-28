import { create } from 'zustand';
import { AiCliStatus, AiConnectionMethod, AiConnectionState, AiProvider, UserSubscription } from '@/types';
import { AIService } from '@/services/ai';
import { getSecureValue, invokeTauriCommand, setSecureValue } from '@/services/tauri';
import { readStorage, writeStorage } from '@/services/storage';
import { createId } from '@/services/ids';
import i18n from '@/i18n';

const PROVIDERS: AiProvider[] = ['openai', 'claude', 'gemini'];
const SECRET_NAMES: Record<AiProvider, string> = {
  openai: 'openai_api_key',
  claude: 'claude_api_key',
  gemini: 'gemini_api_key',
};
const providerMap = <T,>(value: T): Record<AiProvider, T> => ({ openai: value, claude: value, gemini: value });
const defaultModel = (provider: AiProvider): string => ({ openai: 'gpt-4o', claude: 'claude-3-7-sonnet-20250219', gemini: 'gemini-2.0-flash' })[provider];
const isAiProvider = (value: string | null): value is AiProvider => value === 'openai' || value === 'claude' || value === 'gemini';
const isConnectionMethod = (value: string | null): value is AiConnectionMethod => value === 'api_key' || value === 'local_cli';
const projectPreferenceKey = (projectId: string, suffix: string): string => `seomi_project_${encodeURIComponent(projectId)}_ai_${suffix}`;
const AI_PROJECT_MIGRATION_KEY = 'seomi_ai_project_preferences_migrated_v1';
const authRequestTokens = new Map<string, string>();
const apiKeySaveQueues = new Map<AiProvider, Promise<void>>();
const beginAuthRequest = (kind: string): string => {
  const token = createId(`auth-${kind}`);
  authRequestTokens.set(kind, token);
  return token;
};
const isLatestAuthRequest = (kind: string, token: string): boolean => authRequestTokens.get(kind) === token;

interface AuthState {
  subscription: UserSubscription;
  activeProjectId: string | null;
  provider: AiProvider;
  model: string;
  connectionMethod: Record<AiProvider, AiConnectionMethod>;
  apiKeys: Record<AiProvider, string>;
  connectionStatus: Record<AiProvider, AiConnectionState>;
  statusMessages: Record<AiProvider, string>;
  cliStatus: Record<AiProvider, AiCliStatus | null>;
  isHydrated: boolean;
  setProvider: (provider: AiProvider) => void;
  setModel: (model: string) => void;
  setConnectionMethod: (provider: AiProvider, method: AiConnectionMethod) => void;
  hydrateProject: (projectId: string) => void;
  setApiKey: (provider: AiProvider, key: string) => Promise<void>;
  hydrateCredentials: () => Promise<void>;
  detectLocalClients: () => Promise<void>;
  testProviderConnection: (provider: AiProvider) => Promise<{ success: boolean; message: string }>;
  isProviderConnected: (provider?: AiProvider) => boolean;
  generateText: (prompt: string) => Promise<string>;
  generateTextForProvider: (provider: AiProvider, prompt: string) => Promise<string>;
  generateSuggestions: (audit: Parameters<typeof AIService.generateSuggestions>[3], instruction?: string) => ReturnType<typeof AIService.generateSuggestions>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  subscription: { tier: 'direct' },
  activeProjectId: null,
  provider: (readStorage('seomi_ai_provider') as AiProvider) || 'openai',
  model: readStorage('seomi_ai_model') || 'gpt-4o',
  connectionMethod: PROVIDERS.reduce((all, provider) => ({
    ...all,
    [provider]: (readStorage(`seomi_ai_connection_${provider}`) as AiConnectionMethod) || 'api_key',
  }), providerMap<AiConnectionMethod>('api_key')),
  apiKeys: providerMap(''),
  connectionStatus: providerMap<AiConnectionState>('unconfigured'),
  statusMessages: providerMap(''),
  cliStatus: providerMap<AiCliStatus | null>(null),
  isHydrated: false,

  setProvider: (provider) => {
    writeStorage('seomi_ai_provider', provider);
    const projectId = get().activeProjectId;
    if (projectId) writeStorage(projectPreferenceKey(projectId, 'provider'), provider);
    const model = defaultModel(provider);
    writeStorage('seomi_ai_model', model);
    if (projectId) writeStorage(projectPreferenceKey(projectId, 'model'), model);
    set({ provider, model });
  },
  setModel: (model) => {
    writeStorage('seomi_ai_model', model);
    const projectId = get().activeProjectId;
    if (projectId) writeStorage(projectPreferenceKey(projectId, 'model'), model);
    set({ model });
  },
  setConnectionMethod: (provider, method) => {
    beginAuthRequest('connection-' + provider);
    writeStorage(`seomi_ai_connection_${provider}`, method);
    const projectId = get().activeProjectId;
    if (projectId) writeStorage(projectPreferenceKey(projectId, `connection_${provider}`), method);
    set((state) => ({
      connectionMethod: { ...state.connectionMethod, [provider]: method },
      connectionStatus: { ...state.connectionStatus, [provider]: 'unconfigured' },
      statusMessages: { ...state.statusMessages, [provider]: '' },
    }));
  },
  hydrateProject: (projectId) => {
    const migrateLegacyPreferences = readStorage(AI_PROJECT_MIGRATION_KEY) !== '1';
    const storedProvider = readStorage(projectPreferenceKey(projectId, 'provider'));
    const legacyProvider = readStorage('seomi_ai_provider');
    const provider = isAiProvider(storedProvider)
      ? storedProvider
      : migrateLegacyPreferences && isAiProvider(legacyProvider)
        ? legacyProvider
        : 'openai';
    const storedModel = readStorage(projectPreferenceKey(projectId, 'model'));
    const legacyModel = readStorage('seomi_ai_model');
    const model = storedModel?.trim() || (migrateLegacyPreferences && provider === (legacyProvider || '') ? legacyModel?.trim() : '') || defaultModel(provider);
    const connectionMethod = PROVIDERS.reduce((all, item) => {
      const projectValue = readStorage(projectPreferenceKey(projectId, `connection_${item}`));
      const legacyValue = readStorage(`seomi_ai_connection_${item}`);
      all[item] = isConnectionMethod(projectValue)
        ? projectValue
        : migrateLegacyPreferences && isConnectionMethod(legacyValue)
          ? legacyValue
          : 'api_key';
      return all;
    }, providerMap<AiConnectionMethod>('api_key'));

    // Write the migrated values once so a later global preference change cannot
    // leak into an already initialized project.
    writeStorage(projectPreferenceKey(projectId, 'provider'), provider);
    writeStorage(projectPreferenceKey(projectId, 'model'), model);
    PROVIDERS.forEach((item) => writeStorage(projectPreferenceKey(projectId, `connection_${item}`), connectionMethod[item]));
    writeStorage(AI_PROJECT_MIGRATION_KEY, '1');
    set({
      activeProjectId: projectId,
      provider,
      model,
      connectionMethod,
      connectionStatus: providerMap<AiConnectionState>('unconfigured'),
      statusMessages: providerMap(''),
    });
  },
  setApiKey: async (provider, key) => {
    const requestToken = beginAuthRequest('key-' + provider);
    beginAuthRequest('credentials');
    const previous = apiKeySaveQueues.get(provider) || Promise.resolve();
    const save = previous.catch(() => undefined).then(() => setSecureValue(SECRET_NAMES[provider], key)).then(() => undefined);
    apiKeySaveQueues.set(provider, save);
    try {
      await save;
      if (!isLatestAuthRequest('key-' + provider, requestToken)) return;
      set((state) => ({
        apiKeys: { ...state.apiKeys, [provider]: key },
        connectionStatus: { ...state.connectionStatus, [provider]: 'unconfigured' },
        statusMessages: { ...state.statusMessages, [provider]: key.trim() ? i18n.t('runtimeErrors.ai.credentialSaved') : '' },
      }));
    } catch (error) {
      if (!isLatestAuthRequest('key-' + provider, requestToken)) return;
      const detail = error instanceof Error ? error.message : String(error);
      set((state) => ({
        connectionStatus: { ...state.connectionStatus, [provider]: 'error' },
        statusMessages: { ...state.statusMessages, [provider]: i18n.t('runtimeErrors.ai.network', { detail }) },
      }));
      throw error;
    } finally {
      if (apiKeySaveQueues.get(provider) === save) apiKeySaveQueues.delete(provider);
    }
  },
  hydrateCredentials: async () => {
    const requestToken = beginAuthRequest('credentials');
    try {
      const values = await Promise.all(PROVIDERS.map((provider) => getSecureValue(SECRET_NAMES[provider])));
      if (!isLatestAuthRequest('credentials', requestToken)) return;
      set({ apiKeys: { openai: values[0], claude: values[1], gemini: values[2] }, isHydrated: true });
    } catch (error) {
      if (!isLatestAuthRequest('credentials', requestToken)) return;
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({ isHydrated: true, statusMessages: { ...state.statusMessages, [state.provider]: message } }));
    }
  },
  detectLocalClients: async () => {
    const requestToken = beginAuthRequest('cli-detect');
    try {
      const statuses = await invokeTauriCommand<AiCliStatus[]>('detect_ai_clis');
      if (!isLatestAuthRequest('cli-detect', requestToken)) return;
      set({ cliStatus: PROVIDERS.reduce((all, provider) => ({ ...all, [provider]: statuses.find((status) => status.provider === provider) || null }), providerMap<AiCliStatus | null>(null)) });
    } catch (error) {
      if (!isLatestAuthRequest('cli-detect', requestToken)) return;
      const message = error instanceof Error ? error.message : String(error);
      set((state) => ({ statusMessages: { ...state.statusMessages, [state.provider]: message } }));
    }
  },
  testProviderConnection: async (provider) => {
    const method = get().connectionMethod[provider];
    const requestToken = beginAuthRequest('connection-' + provider);
    set((state) => ({ connectionStatus: { ...state.connectionStatus, [provider]: 'testing' }, statusMessages: { ...state.statusMessages, [provider]: i18n.t('runtimeErrors.ai.checkingConnection') } }));
    let response: { success: boolean; message: string };
    try {
      response = method === 'local_cli'
        ? await AIService.testCliConnection(provider)
        : await AIService.testConnection(provider, get().apiKeys[provider]);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      response = { success: false, message: i18n.t('runtimeErrors.ai.network', { detail }) };
    }
    if (!isLatestAuthRequest('connection-' + provider, requestToken)) return response;
    set((state) => ({
      connectionStatus: { ...state.connectionStatus, [provider]: response.success ? 'connected' : 'error' },
      statusMessages: { ...state.statusMessages, [provider]: response.message },
    }));
    return response;
  },
  isProviderConnected: (provider) => get().connectionStatus[provider || get().provider] === 'connected',
  generateText: async (prompt) => {
    const { provider, model, apiKeys, connectionMethod } = get();
    return AIService.generateText(provider, apiKeys[provider], model, prompt, connectionMethod[provider]);
  },
  generateTextForProvider: async (provider, prompt) => {
    const { model, apiKeys, connectionMethod } = get();
    if (connectionMethod[provider] !== 'local_cli') {
      throw new Error(i18n.t('runtimeErrors.ai.localClientRequired', { provider }));
    }
    return AIService.generateText(provider, apiKeys[provider], model, prompt, 'local_cli');
  },
  generateSuggestions: (audit, instruction) => {
    const { provider, model, apiKeys, connectionMethod } = get();
    return AIService.generateSuggestions(provider, apiKeys[provider], model, audit, instruction, connectionMethod[provider]);
  },
}));
